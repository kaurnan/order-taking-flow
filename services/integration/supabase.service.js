const { createClient } = require("@supabase/supabase-js");
const dotenv = require("dotenv");
const FlowstoreList = require("../../models/flowstore/list.model");

dotenv.config();

"use strict";


module.exports = {
    name: "supabase",

    /**
     * Service settings
     */
    settings: {
        supabaseUrl: process.env.SUPABASE_URL,
        supabaseKey: process.env.SUPABASE_KEY,
        bucket: "flowflex",
        fileKey: "flowstorelist.json",
    },

    /**
     * Actions
     */
    actions: {
        // Example action to get a single record by ID
        getRecord: {
            params: {
                table: "string",
                id: "string",
            },
            async handler(ctx) {
                const { table, org_id, session } = ctx.params;
                if (!this.supabase) {
                    this.initializeSupabase();
                }
                const { data, error } = await this.supabase.from(table).select("*").eq("org_id", org_id).eq("session", session).order("updated_at", { ascending: false }).limit(1);
                if (error) {
                    this.logger.error("Error fetching record:", error);
                    throw new Error("Failed to fetch record");
                }
                return data;
            },
        },

        // Example action to fetch data from a table
        getData: {
            params: {
                table: "string",
                filters: { type: "object", optional: true },
            },
            async handler(ctx) {
                const { table, filters } = ctx.params;
                if (!this.supabase) {
                    this.initializeSupabase();
                }
                
                // Determine which fields to select based on filters
                let selectFields = "*";
                if (filters && typeof filters === 'object') {
                    // If we have filters, only select the fields we're filtering on plus essential fields
                    const filterKeys = Object.keys(filters).filter(key => filters[key] !== null && filters[key] !== undefined);
                    if (filterKeys.length > 0) {
                        // Add essential fields that are commonly needed
                        const essentialFields = ["id", "created_at", "updated_at"];
                        const allFields = [...new Set([...filterKeys, ...essentialFields])];
                        selectFields = allFields.join(", ");
                    }
                }
                
                let query = this.supabase.from(table).select(selectFields);
                
                // Apply filters if provided
                if (filters && typeof filters === 'object') {
                    Object.keys(filters).forEach(key => {
                        if (filters[key] !== null && filters[key] !== undefined) {
                            query = query.eq(key, filters[key]);
                        }
                    });
                }
                
                const { data, error } = await query;
                if (error) {
                    this.logger.error("Error fetching data:", error);
                    throw new Error("Failed to fetch data");
                }
                return data;
            },
        },

        // Example action to insert data into a table
        insertData: {
            params: {
                table: "string",
                payload: "object",
            },
            async handler(ctx) {
                const { table, payload } = ctx.params;
                console.log("Inserting data into table:", table, "with payload:", payload);
                if (!this.supabase) {
                    this.initializeSupabase();
                }
                // Ensure payload is an array as required by Supabase
                const insertPayload = Array.isArray(payload) ? payload : [payload];
                const { data, error } = await this.supabase.from(table).insert(insertPayload).select();
                console.log("Insert Data:", data);
                if (error) {
                    console.error("Error inserting data:", error);
                    this.logger.error("Error inserting data:", error);
                    throw new Error("Failed to insert data");
                }
                // Return the inserted row(s)
                return Array.isArray(data) && data.length === 1 ? data[0] : data;
            },
        },

        getDataByMessageId: {
            params: {
                table: "string",
                message_id: "string",
            },
            async handler(ctx) {
                const { table, message_id } = ctx.params;
                console.log("Fetching data from table:", table, "with message_id:", message_id);
                if (!this.supabase) {
                    this.initializeSupabase();
                }
                const { data, error } = await this.supabase.from(table).select("*").eq("message_id", message_id);
                console.log("Get Data By Message ID:", data);
                if (error) {
                    console.error("Error fetching data by message ID:", error);
                    this.logger.error("Error fetching data by message ID:", error);
                    throw new Error("Failed to fetch data by message ID");
                }
                return data;
            },
        },

        updateData: {
            params: {
                table: "string",
                id: { type: "number", optional: true },
                payload: "object",
                message_id: { type: "string", optional: true },
            },
            async handler(ctx) {
                const { table, id, payload, message_id } = ctx.params;
                console.log("Updating data in table:", table, "with ID:", id, "and payload:", payload);
                if (!this.supabase) {
                    this.initializeSupabase();
                }
                let query = this.supabase.from(table).update(payload);
                if (message_id) {
                    query = query.eq("message_id", message_id);
                } else {
                    query = query.eq("id", id);
                }
                const { data, error } = await query.select();
                console.log("Update Data:", data);
                if (error) {
                    console.error("Error updating data:", error);
                    this.logger.error("Error updating data:", error);
                    throw new Error("Failed to update data");
                }
                // Return the updated row(s)
                return Array.isArray(data) && data.length === 1 ? data[0] : data;
            },
        },

        getLatestConversation: {
            params: {
                org_id: "string",
                session: "string",
                channel_id: "string",
            },
            async handler(ctx) {
                const { org_id, session, channel_id } = ctx.params;
                try {
                    if (!this.supabase) {
                        this.initializeSupabase();
                    }
                    const { data, error } = await this.supabase
                        .from("contacts_moleculer")
                        .select("*")
                        .eq("org_id", org_id)
                        .eq("session", session)
                        .eq("channel_id", channel_id)
                        .order("updated_at", { ascending: false })
                        .limit(1);

                    if (error) {
                        this.logger.error(`Error fetching latest conversation for session: ${session}`, error);
                        return null;
                    }

                    if (data && data.length) {
                        return data[0];
                    } else {
                        return null;
                    }
                } catch (error) {
                    this.logger.error("Error while fetching latest conversation from Supabase", error);
                    return null;
                }
            },
        },
    },

    /**
     * Events
     */
    events: {},

    /**
     * Methods
     */
    methods: {
        initializeSupabase() {
            this.supabase = createClient(this.settings.supabaseUrl, this.settings.supabaseKey);
        },
        /**
        * Subscribe to contact_moleculer table changes and push notification on new contact creation
        */
        async subscribeToContactMoleculer() {
            if (!this.supabase) {
                this.logger.error("Supabase client not initialized.");
                return;
            }
            const channel = this.supabase
                .channel("contacts_moleculer")
                .on(
                    "postgres_changes",
                    { event: "INSERT", schema: "public", table: "contact_moleculer" },
                    async (payload) => {
                        try {
                            const newContact = payload.new;
                            await this.broker.call("notification.send", {
                                templateKey: "new_contact",
                                variables: {
                                    contactName: newContact.name,
                                    contactId: newContact.id
                                },
                                additionalData: {
                                    organisation_id: newContact.org_id
                                }
                            });
                            this.logger.info("Notification sent for new contact creation");
                        } catch (err) {
                            this.logger.error("Failed to send notification on contact creation:", err);
                        }
                    }
                )
                .subscribe((status) => {
                    this.logger.info("Subscribed to contact_moleculer inserts:", status);
                });
            this.contactMoleculerChannel = channel;
        },

        async syncJson(change) {
            const fileKey = this.settings.fileKey;
            const bucket = this.settings.bucket;

            // Step 1: Fetch current JSON from Supabase
            const { data, error } = await this.supabase.storage.from(bucket).download(fileKey);
            let json = [];

            if (!error) {
                const text = await data.text();
                json = JSON.parse(text || "[]");
            }

            const { operationType } = change;

            if (operationType === "insert") {
                const fullDocument = await FlowstoreList.findById(change.documentKey._id);
                json.push(fullDocument.toJSON());
            } else if (["update", "replace"].includes(operationType)) {
                const fullDocument = await FlowstoreList.findById(change.documentKey._id);
                const index = json.findIndex((item) => item._id === fullDocument._id.toString());
                console.log("Index of record to update:", index);
                if (index !== -1) {
                    json[index] = {
                        ...json[index],
                        ...fullDocument.toJSON(),
                        _id: { $oid: fullDocument._id.toString() }
                    };
                }
            }
            // Step 2: Overwrite updated JSON
            const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });

            const uploadRes = await this.supabase.storage
                .from(bucket)
                .upload(fileKey, blob, { upsert: true, contentType: "application/json" });

            if (uploadRes.error) throw uploadRes.error;

            this.logger.info("✅ Supabase JSON updated successfully.");
            return { success: true };
        },

        async getJson() {
            const { bucket, fileKey } = this.settings;
            const { data, error } = await this.supabase.storage.from(bucket).download(fileKey);
            if (error) throw error;

            const text = await data.text();
            return JSON.parse(text || "[]");
        },

        async setupFlowStoreListChangeStream() {
            try {
                const FlowStoreListCollection = FlowstoreList.collection;
                if (!FlowStoreListCollection) {
                    this.logger.error("Collection flowstorelist is not defined or invalid.");
                    return;
                }

                // Close existing stream if it exists
                if (this.flowStoreListChangeStream) {
                    try {
                        this.flowStoreListChangeStream.close();
                    } catch (closeError) {
                        this.logger.error("Error closing FlowStoreList ChangeStream:", closeError);
                    }
                }

                this.flowStoreListChangeStream = FlowStoreListCollection.watch();

                this.flowStoreListChangeStream.on("change", async (change) => {
                    this.logger.debug("FlowStoreList change detected:", change);
                    try {
                        await this.syncJson(change);
                    } catch (err) {
                        this.logger.error("❌ Error syncing JSON:", err);
                    }
                });

                // Add error handling and reconnection logic
                this.flowStoreListChangeStream.on("error", async (error) => {
                    this.logger.error("FlowStoreList ChangeStream error:", error)
                });

                // Handle connection close
                this.flowStoreListChangeStream.on("close", () => {
                    this.logger.info("FlowStoreList ChangeStream closed, attempting to reconnect...");
                });

                this.logger.info("FlowStoreList ChangeStream setup completed successfully");

            } catch (error) {
                this.logger.error("Error setting up FlowStoreList ChangeStream:", error);
            }
        }
    },

    /**
     * Service created lifecycle event handler
     */
    created() {
    },

    /**
    * Service started lifecycle event handler (override to subscribe)
    */
    async started() {
        try {
            this.logger.info("Supabase service started.");
            // Initialize Supabase client at service start
            this.initializeSupabase();
            // await this.subscribeToContactMoleculer();
            this.setupFlowStoreListChangeStream();
        }
        catch (error) {
            this.logger.error("Error starting Supabase service:", error);
        }
    },

    /**
     * Service stopped lifecycle event handler
     */
    async stopped() {
        this.logger.info("Supabase service stopped.");
        // Close change stream when service stops
        if (this.flowStoreListChangeStream) {
            try {
                this.flowStoreListChangeStream.close();
            } catch (closeError) {
                this.logger.error("Error closing FlowStoreList ChangeStream:", closeError);
            }
        }
    },
};