const mongoose = require("mongoose");
const { MongoClient } = require("mongodb");

let connectPromise;

function connectMongo() {
    if (!connectPromise) {
        const uri = process.env.MONGO_URI;
        if (!uri) throw new Error("MONGO_URI not set");
        
        // Create a new MongoDB client connection
        const client = new MongoClient(uri, {
            maxPoolSize: 5,
            minPoolSize: 0,
            serverSelectionTimeoutMS: 10000,
            socketTimeoutMS: 45000,
            appName: "flowflex-workers"
        });
        
        connectPromise = client.connect().then(client => {
            // Return the database instance
            return client.db();
        });
    }
    return connectPromise;
}

module.exports = { connectMongo };
