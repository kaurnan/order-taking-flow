const { Storage } = require("@google-cloud/storage");
const { WorkflowsClient, ExecutionsClient } = require("@google-cloud/workflows");
const path = require("path");
const { default: axios } = require("axios");
const { CloudSchedulerClient } = require("@google-cloud/scheduler");
const { CloudTasksClient } = require("@google-cloud/tasks");
const { getTimeZoneFromOffset, updategcpBatchDetails } = require("../../utils/common");
const { MoleculerError } = require("moleculer").Errors;
const fs = require("fs");
const os = require("os");

require("dotenv").config();

"use strict";

module.exports = {
    name: "gcp",
    actions: {
        upload: {
            auth: "required",
            params: {},
            async handler(ctx) {
                const { org_id, branch_id } = ctx.meta;
                const buffer = await this.streamToBuffer(ctx.params);
                const { upload_to_meta, type, fileName, totalChunks, chunkIndex, fileType } = ctx.meta.$multipart;
                const tempDir = path.join(os.tmpdir(), "chunk-uploads", fileName);
                const chunkPath = path.join(tempDir, `chunk_${chunkIndex}`);

                await fs.promises.mkdir(tempDir, { recursive: true });
                await fs.promises.writeFile(chunkPath, buffer);

                const uploadToGCP = async (buf, name, type) => {
                    return await ctx.call("gcp.uploadFile", {
                        bucket: process.env.GCP_BUCKET,
                        filename: name,
                        buffer: buf,
                        contentType: type,
                        metadata: { org_id, branch_id, filename: name },
                    });
                };

                const uploadToMeta = async () => {
                    const sessionRes = await axios.post(
                        `https://graph.facebook.com/v23.0/${process.env.FACEBOOK_APP_ID}/uploads`, null,
                        {
                            params: {
                                file_name: fileName,
                                file_length: buffer.length,
                                file_type: ctx.meta.mimetype,
                                access_token: process.env.CLOUD_API_ACCESS_TOKEN,
                            }
                        }
                    );

                    const uploadRes = await axios.post(
                        `https://graph.facebook.com/v23.0/${sessionRes.data.id}`,
                        buffer,
                        {
                            headers: {
                                "Content-Type": ctx.meta.mimetype,
                                "Authorization": `OAuth ${process.env.CLOUD_API_ACCESS_TOKEN}`,
                                "file_offset": 0,
                            },
                        }
                    );

                    return { sessionId: sessionRes.data.id, imgHandle: uploadRes.data.h };
                };

                // === 1. DIRECT UPLOAD TO GCP + META ===
                if (buffer.length && upload_to_meta === "yes") {
                    const gcpRes = await uploadToGCP(buffer, fileName, ctx.meta.mimetype);
                    const metaRes = await uploadToMeta();

                    if (gcpRes.success && metaRes.sessionId && metaRes.imgHandle) {
                        return {
                            success: true,
                            url: gcpRes.url,
                            filename: fileName,
                            img_handle: metaRes.imgHandle,
                        };
                    }
                    throw new MoleculerError("Meta or GCP upload failed", 500, "UPLOAD_ERROR");
                }

                // === 2. CHUNKED UPLOAD ===
                if (buffer.length && type === "chunk") {
                    if (!this.chunks) this.chunks = {};
                    if (!this.chunks[fileName]) this.chunks[fileName] = [];
                    this.chunks[fileName][chunkIndex] = buffer;

                    const uploadedCount = this.chunks[fileName].filter(Boolean).length;

                    if (uploadedCount === parseInt(totalChunks, 10)) {
                        const completeBuffer = Buffer.concat(this.chunks[fileName].filter(Boolean));
                        const tempFilePath = path.join(__dirname, fileName);

                        try {
                            fs.writeFileSync(tempFilePath, completeBuffer);
                            const gcpRes = await ctx.call("gcp.uploadFile", {
                                bucket: process.env.GCP_BUCKET,
                                filename: fileName,
                                buffer: completeBuffer,
                                contentType: fileType,
                            });

                            delete this.chunks[fileName]; // Clear memory

                            if (gcpRes.success) {
                                return {
                                    success: true,
                                    url: gcpRes.url,
                                    filename: fileName,
                                };
                            }
                            throw new MoleculerError("GCP upload failed after chunk merge", 500, "UPLOAD_ERROR");
                        } catch (err) {
                            console.error("File write error:", err);
                            throw new MoleculerError("Error writing file", 500, "FILE_WRITE_ERROR");
                        }
                    }

                    return { success: true, status: "Chunk received" };
                }

                // === 3. SINGLE CHUNK (not multipart) ===
                const gcpRes = await uploadToGCP(buffer, fileName, ctx.meta.mimetype);
                if (gcpRes.success) {
                    return {
                        success: true,
                        url: gcpRes.url,
                        filename: fileName,
                    };
                }

                throw new MoleculerError("Standard GCP upload failed", 500, "UPLOAD_ERROR");
            }
        },

        /**
         * Uploads a file buffer to a GCP bucket and returns the file URL.
         * @param {String} bucket - Bucket name
         * @param {String} filename - Destination filename in bucket
         * @param {Buffer} buffer - File buffer
         * @param {String} [contentType] - Optional content type
         * @param {Object} [metadata] - Optional metadata object
         */
        async uploadFile(ctx) {
            try {
                const { bucket, filename, buffer, contentType, metadata } = ctx.params;
                if (!bucket || !filename || !buffer) {
                    throw new Error("Missing required parameters.");
                }
                const file = this.storage.bucket(bucket).file(filename);
                const options = {};
                if (contentType) options.contentType = contentType;
                if (metadata) options.metadata = metadata;

                await file.save(buffer, options);

                // Get file metadata to construct URL
                const [meta] = await file.getMetadata();
                const fileUrl = `https://storage.googleapis.com/${meta.bucket}/${meta.name}`;

                return {
                    success: true,
                    filename,
                    url: fileUrl
                };
            } catch (err) {
                this.logger.error("GCP uploadFile error:", err);
                return {
                    success: false,
                    error: err.message || "Unknown error"
                };
            }
        },
        async listWorkflows(ctx) {
            const { projectId, location } = ctx.params;
            const [workflows] = await this.workflow.listWorkflows({
                parent: this.workflow.locationPath(projectId, location),
            });
            return workflows;
        },
        async scheduleGCPCloudSchedulerJob(ctx) {
            try {
                const { batchNumber, scheduledDate, payload } = ctx.params;
                // Ensure scheduledDate is a Date object
                const dateObj = (scheduledDate instanceof Date) ? scheduledDate : new Date(scheduledDate);
                if (isNaN(dateObj.getTime())) {
                    throw new Error("Invalid scheduledDate provided.");
                }
                const schedule = `${dateObj.getUTCMinutes()} ${dateObj.getUTCHours()} ${dateObj.getUTCDate()} ${dateObj.getUTCMonth() + 1} *`;
                console.log(schedule);
                const projectId = process.env.GCP_PROJECT_ID;
                const location = process.env.GCP_LOCATION;
                const functionUrl = process.env.BROADCAST_SCHEDULER_TARGET; // URL for your Cloud Function

                const parent = `projects/${projectId}/locations/${location}`;
                const job = {
                    httpTarget: {
                        uri: functionUrl,
                        httpMethod: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: Buffer.from(JSON.stringify(payload)).toString("base64"),
                    },
                    schedule,
                    timeZone: getTimeZoneFromOffset(scheduledDate.getTimezoneOffset()),
                    description: `Schedule batch ${batchNumber} for broadcast`,
                };

                const request = {
                    parent,
                    job,
                };
                const [response] = await this.schedulerClient.createJob(request);
                const jobId = response?.name?.split("/").pop();
                if (response?.httpTarget?.body) {
                    const decodedBody = Buffer.from(response.httpTarget.body).toString("utf8");
                    const decodedPayload = JSON.parse(decodedBody);
                    await updategcpBatchDetails(ctx, decodedPayload, jobId ?? "", batchNumber, scheduledDate);
                }
                console.log(`Job ${jobId} created for batch ${batchNumber} at ${scheduledDate}`);
            } catch (error) {
                console.error("Failed to create Google Cloud Scheduler job:");
                console.error(error);
            }
        },
        async createTask(ctx) {
            try {
                const { data } = ctx.params;
                console.log(`Project ID: ${process.env.GCP_PROJECT_ID}, Location: ${process.env.BROADCAST_QUEUE_LOCATION}, Queue: ${process.env.BROADCAST_QUEUE}`);

                const queuePath = this.tasksClient.queuePath(
                    process.env.GCP_PROJECT_ID ?? "",
                    process.env.BROADCAST_QUEUE_LOCATION ?? "",
                    process.env.BROADCAST_QUEUE ?? ""
                );

                // Construct full URL with query parameters
                let taskUrl = process.env.WHATSAPP_SEND_UTIL;

                const task = {
                    httpRequest: {
                        httpMethod: "POST",
                        url: taskUrl,
                        body: Buffer.from(JSON.stringify(data)),
                        headers: {
                            "Content-Type": "application/json",
                        },
                    },
                };

                const request = { parent: queuePath, task };
                const [response] = await this.tasksClient.createTask(request);

                console.log(`Created task with ID: ${response.name}`);
            } catch (error) {
                console.error("Failed to create Cloud Task:", error);
            }
        },
        async deleteJob(ctx) {
            const { cronJobName } = ctx.params;
            const projectId = process.env.GCP_PROJECT_ID;
            const location = process.env.GCP_LOCATION;
            const jobName = `projects/${projectId}/locations/${location}/jobs/${cronJobName}`;

            try {
                const request = { name: jobName };
                const response = await this.schedulerClient.deleteJob(request);
                console.info("Job deleted:");
                console.info(response);
            } catch (error) {
                console.error("Failed to delete cron job:");
                console.error(error);
            }
        },
        async executeWorkflow(ctx) {
            try {
                const { projectId, location, workflow, trigger } = ctx.params;
                console.group("Executing workflow");
                const createExecutionRes = await this.Executionclient.createExecution({
                    parent: this.Executionclient.workflowPath(projectId, location, workflow),
                    execution: {
                        argument: JSON.stringify(trigger),
                    },
                });
                if (createExecutionRes && createExecutionRes.length > 0) {
                    const executionName = createExecutionRes[0]?.name;
                    console.log("info", `Created execution: ${executionName}`);
                }
            } catch (e) {
                console.error("Error executing workflow:", e);
            }
        }
    },

    methods: {
        async streamToBuffer(stream) {
            const chunks = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }
            return Buffer.concat(chunks);
        }
    },

    created() {
        const projectRoot = path.resolve(__dirname, "..");
        const keyFilename = path.join(projectRoot, "../gcp/service_account.json");
        this.storage = new Storage({
            keyFilename,
            projectId: process.env.GCP_PROJECT_ID
        });
        this.workflow = new WorkflowsClient({ keyFilename });
        this.schedulerClient = new CloudSchedulerClient({ keyFilename });
        this.tasksClient = new CloudTasksClient({ keyFilename });
        this.Executionclient = new ExecutionsClient({ keyFilename });
        this.chunks = {};
    }
};