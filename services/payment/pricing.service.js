"use strict";

const DbMixin = require("../../mixins/db.mixin");
const defaultPricingPlans = require("../../mixins/seedData/pricings.json");

module.exports = {
    name: "pricing",
    mixins: [DbMixin("pricing")],
    settings: {
        // Default pagination settings
        defaultLimit: 20,
        maxLimit: 100
    },

    actions: {
        // List all pricing plans with filtering and pagination
        listPricingPlans: {
            rest: "GET /",
            auth: "required",
            params: {
                page: { type: "number", positive: true, integer: true, optional: true },
                limit: { type: "number", positive: true, integer: true, optional: true },
                type: { type: "string", enum: ["one-time", "subscription", "custom", "freemium"], optional: true },
                is_active: { type: "boolean", optional: true },
                is_popular: { type: "boolean", optional: true },
                search: { type: "string", optional: true },
                sort_by: { type: "string", enum: ["name", "pricing", "sort_order", "createdAt"], optional: true },
                sort_order: { type: "string", enum: ["asc", "desc"], optional: true }
            },
            async handler(ctx) {
                const {
                    page = 1,
                    limit = this.settings.defaultLimit,
                    type,
                    is_active,
                    is_popular,
                    search,
                    sort_by = "sort_order",
                    sort_order = "asc"
                } = ctx.params;

                // Validate limit
                const validatedLimit = Math.min(limit, this.settings.maxLimit);
                const skip = (page - 1) * validatedLimit;

                // Build query
                const query = {};
                if (type) query.type = type;
                if (is_active !== undefined) query.is_active = is_active;
                if (is_popular !== undefined) query.is_popular = is_popular;
                if (search) {
                    query.$or = [
                        { name: { $regex: search, $options: 'i' } },
                        { desc: { $regex: search, $options: 'i' } },
                        { slug: { $regex: search, $options: 'i' } }
                    ];
                }

                // Build sort
                const sort = {};
                sort[sort_by] = sort_order === 'desc' ? -1 : 1;

                const [pricingPlans, total] = await Promise.all([
                    this.adapter.find({
                        query,
                        skip,
                        limit: validatedLimit,
                        sort
                    }),
                    this.adapter.count({ query })
                ]);

                pricingPlans.sort((a, b) => {
                    if (a.sort_order === b.sort_order) {
                        return 0;
                    }
                    return a.sort_order - b.sort_order;
                });


                return {
                    success: true,
                    message: "Pricing plans fetched successfully",
                    data: pricingPlans,
                    pagination: {
                        page,
                        limit: validatedLimit,
                        total,
                        pages: Math.ceil(total / validatedLimit)
                    }
                };
            }
        },

        listPricings: {
            rest: "GET /",
            params: {
                page: { type: "number", positive: true, integer: true, optional: true },
                limit: { type: "number", positive: true, integer: true, optional: true },
                type: { type: "string", enum: ["one-time", "subscription", "custom", "freemium"], optional: true },
                is_active: { type: "boolean", optional: true },
                is_popular: { type: "boolean", optional: true },
                search: { type: "string", optional: true },
                sort_by: { type: "string", enum: ["name", "pricing", "sort_order", "createdAt"], optional: true },
                sort_order: { type: "string", enum: ["asc", "desc"], optional: true }
            },
            async handler(ctx) {
                const {
                    page = 1,
                    limit = this.settings.defaultLimit,
                    type,
                    is_active,
                    is_popular,
                    search,
                    sort_by = "sort_order",
                    sort_order = "asc"
                } = ctx.params;

                // Validate limit
                const validatedLimit = Math.min(limit, this.settings.maxLimit);
                const skip = (page - 1) * validatedLimit;

                // Build query
                const query = {};
                if (type) query.type = type;
                if (is_active !== undefined) query.is_active = is_active;
                if (is_popular !== undefined) query.is_popular = is_popular;
                if (search) {
                    query.$or = [
                        { name: { $regex: search, $options: 'i' } },
                        { desc: { $regex: search, $options: 'i' } },
                        { slug: { $regex: search, $options: 'i' } }
                    ];
                }

                // Build sort
                const sort = {};
                sort[sort_by] = sort_order === 'desc' ? -1 : 1;

                const [pricingPlans, total] = await Promise.all([
                    this.adapter.find({
                        query,
                        skip,
                        limit: validatedLimit,
                        sort
                    }),
                    this.adapter.count({ query })
                ]);

                return {
                    success: true,
                    message: "Pricing plans fetched successfully",
                    data: pricingPlans,
                    pagination: {
                        page,
                        limit: validatedLimit,
                        total,
                        pages: Math.ceil(total / validatedLimit)
                    }
                };
            }
        },

        // Get a single pricing plan by ID
        get: {
            rest: "GET /:id",
            auth: "required",
            params: {
                id: { type: "string" }
            },
            async handler(ctx) {
                const { id } = ctx.params;
                const pricingPlan = await this.adapter.findById(id);
                if (!pricingPlan) {
                    throw new Error("Pricing plan not found");
                }
                return pricingPlan;
            }
        },

        // Get pricing plan by slug
        getBySlug: {
            rest: "GET /slug/:slug",
            cache: {
                keys: ["slug"]
            },
            auth: "required",
            params: {
                slug: { type: "string" }
            },
            async handler(ctx) {
                const { slug } = ctx.params;
                const pricingPlan = await this.adapter.findOne({ slug });
                if (!pricingPlan) {
                    throw new Error("Pricing plan not found");
                }
                return pricingPlan;
            }
        },

        // Get active pricing plans
        getActive: {
            rest: "GET /active",
            cache: true,
            auth: "required",
            params: {
                type: { type: "string", enum: ["one-time", "subscription", "custom", "freemium"], optional: true },
                popular_only: { type: "boolean", optional: true }
            },
            async handler(ctx) {
                const { type, popular_only } = ctx.params;

                const query = { is_active: true };
                if (type) query.type = type;
                if (popular_only) query.is_popular = true;

                const pricingPlans = await this.adapter.find({
                    query,
                    sort: { sort_order: 1, pricing: 1 }
                });

                return pricingPlans;
            }
        },

        // Compare pricing plans
        compare: {
            rest: "POST /compare",
            auth: "required",
            params: {
                plan_ids: { type: "array", items: "string", min: 2, max: 5 }
            },
            async handler(ctx) {
                const { plan_ids } = ctx.params;

                const pricingPlans = await this.adapter.find({
                    query: { _id: { $in: plan_ids } },
                    sort: { sort_order: 1, pricing: 1 }
                });

                if (pricingPlans.length !== plan_ids.length) {
                    throw new Error("Some pricing plans not found");
                }

                // Generate comparison data
                const comparison = {
                    plans: pricingPlans,
                    features: this.getUniqueFeatures(pricingPlans),
                    limits: this.getLimitComparison(pricingPlans)
                };

                return comparison;
            }
        },

        // Calculate pricing for a plan
        calculatePrice: {
            rest: "POST /calculate",
            auth: "required",
            params: {
                plan_id: { type: "string" },
                billing_cycle: { type: "string", enum: ["monthly", "yearly", "quarterly"], optional: true },
                quantity: { type: "number", positive: true, integer: true, optional: true }
            },
            async handler(ctx) {
                const { plan_id, billing_cycle, quantity = 1 } = ctx.params;

                const pricingPlan = await this.adapter.findById(plan_id);
                if (!pricingPlan) {
                    throw new Error("Pricing plan not found");
                }

                const calculation = this.calculatePricing(pricingPlan, billing_cycle, quantity);
                return calculation;
            }
        }
    },

    methods: {
        // Get unique features from multiple plans
        getUniqueFeatures(pricingPlans) {
            const allFeatures = new Set();
            pricingPlans.forEach(plan => {
                if (plan.features) {
                    plan.features.forEach(feature => {
                        allFeatures.add(feature.name);
                    });
                }
            });
            return Array.from(allFeatures);
        },

        // Get limit comparison for multiple plans
        getLimitComparison(pricingPlans) {
            const limits = {};
            const limitKeys = ['users', 'storage', 'api_calls', 'messages', 'integrations', 'custom_fields', 'workflows', 'templates'];

            limitKeys.forEach(key => {
                limits[key] = {};
                pricingPlans.forEach(plan => {
                    limits[key][plan._id] = plan.limits?.[key] || 0;
                });
            });

            return limits;
        },

        // Calculate pricing for a plan
        calculatePricing(pricingPlan, billingCycle, quantity) {
            let basePrice = pricingPlan.pricing;
            let billingMultiplier = 1;
            let discountPercentage = 0;

            // Apply billing cycle multiplier and discounts
            if (billingCycle && billingCycle !== pricingPlan.billing_cycle) {
                switch (billingCycle) {
                    case 'yearly':
                        billingMultiplier = 12;
                        discountPercentage = pricingPlan.yearly_discount_percentage || 0;
                        break;
                    case 'quarterly':
                        billingMultiplier = 3;
                        discountPercentage = 10; // Default 10% discount for quarterly
                        break;
                    case 'monthly':
                        billingMultiplier = 1;
                        break;
                }
            } else {
                // Use plan's default billing cycle
                switch (pricingPlan.billing_cycle) {
                    case 'yearly':
                        billingMultiplier = 12;
                        discountPercentage = pricingPlan.yearly_discount_percentage || 0;
                        break;
                    case 'quarterly':
                        billingMultiplier = 3;
                        discountPercentage = 10;
                        break;
                    case 'monthly':
                        billingMultiplier = 1;
                        break;
                }
            }

            // Calculate base price with billing cycle
            const cyclePrice = basePrice * billingMultiplier;

            // Apply billing cycle discount
            const discountedCyclePrice = cyclePrice * (1 - discountPercentage / 100);

            // Apply quantity
            const subtotal = discountedCyclePrice * quantity;

            // Apply additional discounts (if any)
            let finalPrice = subtotal;
            if (pricingPlan.discount_percentage > 0 &&
                (!pricingPlan.discount_valid_until || pricingPlan.discount_valid_until > new Date())) {
                finalPrice = subtotal * (1 - pricingPlan.discount_percentage / 100);
            }

            // Add setup fee
            const total = finalPrice + pricingPlan.setup_fee;

            return {
                plan: pricingPlan,
                quantity,
                billing_cycle: billingCycle || pricingPlan.billing_cycle,
                billing_multiplier: billingMultiplier,
                cycle_price: cyclePrice,
                cycle_discount_percentage: discountPercentage,
                discounted_cycle_price: discountedCyclePrice,
                subtotal,
                additional_discount_amount: subtotal - finalPrice,
                setup_fee: pricingPlan.setup_fee,
                total,
                currency: pricingPlan.currency,
                monthly_equivalent: total / (billingMultiplier * quantity)
            };
        },

        // Seed database with default pricing plans
        async seedDB() {
            const existingPlans = await this.adapter.find({});
            if (existingPlans.length > 0) {
                this.logger.info("Pricing plans already exist, skipping seed");
                return;
            }

            await this.adapter.insertMany(defaultPricingPlans);
            this.logger.info("Default pricing plans seeded successfully");
        }
    },

    async created() {

        // Seed DB with default pricing plans if empty
        console.log("Pricing service created");
    }
};
