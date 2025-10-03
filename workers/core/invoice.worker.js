const { Worker } = require("bullmq");
const { connectMongo } = require("../../mixins/db");
const Invoice = require("../../models/invoice.model");
const Organisation = require("../../models/ums/organisation.model"); // Assuming this is the path to your Organisation model
const dotenv = require("dotenv");
const archiver = require("archiver"); // For creating zip files
const fs = require("fs");
const path = require("path");
const cdn = require("../../utils/cdn"); // CDN utility
const { ServiceBroker } = require("moleculer"); // Import ServiceBroker
const { default: Redis } = require("ioredis");

dotenv.config();

const connection = new Redis(process.env.REDIS_URI);
connection.options.maxRetriesPerRequest = null;

// Create a new broker instance for emitting events
const broker = new ServiceBroker({
    nodeID: `invoice-worker-${Date.now()}-${process.pid}`,
    transporter: process.env.TRANSPORTER, // Use NATS or other transporter
    logLevel: "warn",
});

console.log('Transporter: invoice-worker', process.env.TRANSPORTER);

broker.start(); // Start the broker

(async () => {
    await connectMongo();
    console.log("Mongo ready for invoice");
})().catch(err => {
    console.error("Mongo connect error (invoice):", err);
    process.exit(1);
});

const invoiceWorker = new Worker(
    "invoiceQueue",
    async (job) => {
        const { type } = job.data;

        if (type === "createMonthlyInvoices") {
            console.log("Processing createMonthlyInvoices job...");
            const organizations = await Organisation.find({}); // Fetch all organizations

            for (const org of organizations) {
                const invoice = new Invoice({
                    organizationId: org._id,
                    invoiceDate: new Date(),
                    amount: 0, // You'll need to calculate this based on your pricing logic
                    status: "pending",
                });
                await invoice.save();
                console.log(`Invoice created for organization: ${org.name} (${org._id})`);
            }
            console.log("Finished creating monthly invoices.");
        } else if (type === "downloadAllInvoices") {
            console.log("Processing downloadAllInvoices job...");
            const { orgId, invoiceIds, selectAll, userId } = job.data;

            let invoicesToDownload;
            if (selectAll) {
                invoicesToDownload = await Invoice.find({ org_id: orgId }).lean();
            } else if (invoiceIds && invoiceIds.length > 0) {
                invoicesToDownload = await Invoice.find({ _id: { $in: invoiceIds }, org_id: orgId }).lean();
            } else {
                throw new Error("No invoices specified for download.");
            }

            if (invoicesToDownload.length === 0) {
                console.log("No invoices found to download.");
                await broker.emit("notification.sendEvent", {
                    templateKey: "invoiceDownloadFailed",
                    variables: { orgId },
                    additionalData: { user_id: userId, organisation_id: orgId },
                });
                return;
            }

            const invoiceFiles = [];
            for (const invoice of invoicesToDownload) {
                let fileContent;
                let fileName = `invoice-${invoice.invoiceNumber}.pdf`; // Assuming PDF for downloaded invoices

                if (invoice.file) {
                    // If a CDN link exists, download the file
                    console.log(`Downloading invoice ${invoice.invoiceNumber} from CDN: ${invoice.file}`);
                    try {
                        fileContent = await cdn.downloadFileFromCDN(invoice.file);
                        // Extract filename from CDN URL if needed, or use a default
                        const urlParts = invoice.file.split('/');
                        fileName = urlParts[urlParts.length - 1];
                    } catch (error) {
                        console.error(`Failed to download invoice ${invoice.invoiceNumber} from CDN: ${invoice.file}`, error);
                        // Fallback to generating a placeholder if download fails
                        fileContent = `Invoice Number: ${invoice.invoiceNumber}\nAmount: ${invoice.amount}\nDate: ${invoice.invoiceDate}\n(CDN download failed, this is a placeholder)`;
                        fileName = `invoice-${invoice.invoiceNumber}.txt`;
                    }
                } else {
                    // Generate placeholder if no CDN link
                    fileContent = `Invoice Number: ${invoice.invoiceNumber}\nAmount: ${invoice.amount}\nDate: ${invoice.invoiceDate}`;
                    fileName = `invoice-${invoice.invoiceNumber}.txt`;
                }
                invoiceFiles.push({ name: fileName, content: fileContent });
            }
            const archiveName = `invoices-${orgId}-${Date.now()}.zip`;
            const output = fs.createWriteStream(path.join(__dirname, archiveName));
            const archive = archiver("zip", {
                zlib: { level: 9 }, // Sets the compression level.
            });

            output.on("close", async () => {
                console.log(archive.pointer() + " total bytes");
                console.log("Archiver has been finalized and the output file descriptor has closed.");

                // Upload to CDN
                const destinationFolder = `invoices/${orgId}`;
                const fileBuffer = fs.readFileSync(path.join(__dirname, archiveName));
                const cdnUrl = await cdn.saveFileToCDN(archiveName, fileBuffer, destinationFolder, "application/zip");

                // Clean up local archive file
                fs.unlinkSync(path.join(__dirname, archiveName));

                // Send notification
                await broker.emit("notification.sendEvent", {
                    templateKey: "invoiceDownloadComplete",
                    variables: { downloadUrl: cdnUrl, orgId },
                    additionalData: { user_id: userId, organisation_id: orgId, broadcast_type: 'org' },
                });
                console.log(`Invoices archived and uploaded to CDN: ${cdnUrl}`);
            });

            archive.on("warning", (err) => {
                if (err.code === "ENOENT") {
                    console.warn("Archiver warning:", err);
                } else {
                    throw err;
                }
            });

            archive.on("error", async (err) => {
                console.error("Archiver error:", err);
                await broker.emit("notification.sendEvent", {
                    templateKey: "invoiceDownloadFailed",
                    variables: { orgId, error: err.message },
                    additionalData: { user_id: userId, organisation_id: orgId, broadcast_type: 'org' },
                });
                throw err;
            });

            archive.pipe(output);

            for (const file of invoiceFiles) {
                // If content is a Buffer (from CDN download), append directly
                if (Buffer.isBuffer(file.content)) {
                    archive.append(file.content, { name: file.name });
                } else {
                    // Otherwise, assume it's a string and append
                    archive.append(file.content, { name: file.name });
                }
            }

            await archive.finalize();
            console.log("Finished processing downloadAllInvoices job.");
        }
    },
    {
        connection,
    }
);

invoiceWorker.on("completed", (job) => {
    console.log(`Job ${job.id} completed!`);
});

invoiceWorker.on("failed", (job, err) => {
    console.error(`Job ${job.id} failed with error ${err.message}`);
});

module.exports = invoiceWorker;
