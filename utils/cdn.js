const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");
const { Storage } = require("@google-cloud/storage");

dotenv.config();

const keyFilename = path.join(path.dirname(__filename), "../gcp/service_account.json");
const storage = new Storage({ keyFilename, projectId: process.env.GCP_PROJECT_ID });

async function saveFileToCDN(fileName, file, destination, contentType = "application/octet-stream", bucketName = process.env.GCP_BUCKET ?? "") {
    try {
        const tempFilePath = path.join(__dirname, `${fileName}`);
        if (file) {
            fs.writeFileSync(tempFilePath, file);
            await storage.bucket(process.env.GCP_BUCKET ?? "").upload(tempFilePath, {
                destination: `${destination}/${fileName}`,
                metadata: {
                    contentType: contentType,
                    metadata: {
                        originalname: fileName,
                        mimetype: contentType,
                    },
                },
            });
            fs.unlinkSync(tempFilePath);
        }

        const [metadata] = await storage.bucket(bucketName).file(`${destination}/${fileName}`).getMetadata();
        const fileUrl = `https://storage.googleapis.com/${metadata.bucket}/${metadata.name}`;

        return fileUrl;
    } catch (error) {
        throw new Error(`Error saving file to CDN: ${error.message}`);
    }
}

async function downloadFileFromCDN(fileUrl, bucketName = process.env.GCP_BUCKET ?? "") {
    try {
        const url = new URL(fileUrl);
        const fullPath = url.pathname.substring(1); // e.g., "flowflex_bucket_staging/sample-invoice.pdf"
        const bucketPrefix = `${bucketName}/`;

        let filePath;
        if (fullPath.startsWith(bucketPrefix)) {
            filePath = fullPath.substring(bucketPrefix.length); // e.g., "sample-invoice.pdf"
        } else {
            filePath = fullPath; // Fallback if the URL structure is unexpected
        }

        const file = storage.bucket(bucketName).file(filePath);
        const [buffer] = await file.download();
        return buffer;
    } catch (error) {
        throw new Error(`Error downloading file from CDN: ${error.message}`);
    }
}

module.exports = { saveFileToCDN, downloadFileFromCDN };
