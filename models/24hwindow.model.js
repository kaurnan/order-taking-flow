
const mongoose = require("mongoose");

const TwentyFourHourWindowSchema = new mongoose.Schema({
    utility: { type: Number, required: true },
    marketing: { type: Number, required: true },
    service: { type: Number, required: true },
    authentication: { type: Number, required: true },
    unbilled__utility: { type: Number, default: 0 },
    unbilled__marketing: { type: Number, default: 0 },
    unbilled__service: { type: Number, default: 0 },
    unbilled__authentication: { type: Number, default: 0 },
    branch_id: { type: mongoose.Types.ObjectId, ref: "branch", required: true },
    org_id: { type: mongoose.Types.ObjectId, ref: "Organisation", required: true },
});


module.exports = mongoose.model("24hwindow", TwentyFourHourWindowSchema);
