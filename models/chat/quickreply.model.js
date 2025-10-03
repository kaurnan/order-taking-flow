const mongoose = require("mongoose");

const QuickReplySchema = new mongoose.Schema({
    org_id: { type: mongoose.Schema.Types.ObjectId, ref: "organisations", unique: true },
    reply: { type: [mongoose.Schema.Types.Mixed] },
});

const QuickReply = mongoose.model("quickreplies", QuickReplySchema);

module.exports = QuickReply;