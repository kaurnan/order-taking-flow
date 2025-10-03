"use strict";

const { MoleculerError } = require("moleculer").Errors;
const axios = require("axios");

module.exports = {
    name: "meta-catalogue",

    /**
     * Service dependencies
     */
    dependencies: [],

    /**
     * Actions
     */
    actions: {
        /**
         * Fetch products from Meta Commerce Manager catalogue
         */
        getCatalogueProducts: {
            auth: false,
            params: {
                catalogueId: "string",
                accessToken: { type: "string", optional: true },
                limit: { type: "number", optional: true, default: 25, convert: true },
                after: { type: "string", optional: true }
            },
            async handler(ctx) {
                const { catalogueId, accessToken, limit, after } = ctx.params;
                
                // Use provided accessToken or fall back to environment variable
                const token = accessToken || process.env.CLOUD_API_ACCESS_TOKEN;

                try {
                    this.logger.info(`Fetching products from catalogue: ${catalogueId}`);

                    // Meta Graph API endpoint for fetching catalogue products with detailed fields
                    const url = `https://graph.facebook.com/v18.0/${catalogueId}/products`;
                    
                    const params = {
                        access_token: token,
                        limit: limit,
                        fields: "id,name,description,image_url,price,availability,retailer_id"
                    };

                    if (after) {
                        params.after = after;
                    }

                    const response = await axios.get(url, { params });

                    if (response.data && response.data.data) {
                        this.logger.info(`Successfully fetched ${response.data.data.length} products from catalogue`);
                        
                        return {
                            success: true,
                            products: response.data.data,
                            paging: response.data.paging || null,
                            total: response.data.data.length
                        };
                    } else {
                        throw new Error("No products found in catalogue");
                    }

                } catch (error) {
                    this.logger.error("Error fetching catalogue products:", error);
                    
                    if (error.response) {
                        const errorData = error.response.data;
                        throw new MoleculerError(
                            `Meta API Error: ${errorData.error?.message || error.message}`,
                            error.response.status,
                            "META_CATALOGUE_FETCH_ERROR",
                            { error: errorData }
                        );
                    }
                    
                    throw new MoleculerError(
                        `Failed to fetch catalogue products: ${error.message}`,
                        500,
                        "CATALOGUE_FETCH_ERROR"
                    );
                }
            }
        },

        /**
         * Get specific product from catalogue by retailer ID
         */
        getCatalogueProduct: {
            auth: "required",
            params: {
                catalogueId: "string",
                productRetailerId: "string",
                accessToken: "string"
            },
            async handler(ctx) {
                const { catalogueId, productRetailerId, accessToken } = ctx.params;

                try {
                    this.logger.info(`Fetching product ${productRetailerId} from catalogue: ${catalogueId}`);

                    // Meta Graph API endpoint for fetching specific product
                    const url = `https://graph.facebook.com/v18.0/${catalogueId}/products`;
                    
                    const params = {
                        access_token: accessToken,
                        retailer_id: productRetailerId
                    };

                    const response = await axios.get(url, { params });

                    if (response.data && response.data.data && response.data.data.length > 0) {
                        const product = response.data.data[0];
                        this.logger.info(`Successfully fetched product: ${product.name}`);
                        
                        return {
                            success: true,
                            product: product
                        };
                    } else {
                        throw new Error(`Product with retailer ID ${productRetailerId} not found`);
                    }

                } catch (error) {
                    this.logger.error("Error fetching catalogue product:", error);
                    
                    if (error.response) {
                        const errorData = error.response.data;
                        throw new MoleculerError(
                            `Meta API Error: ${errorData.error?.message || error.message}`,
                            error.response.status,
                            "META_PRODUCT_FETCH_ERROR",
                            { error: errorData }
                        );
                    }
                    
                    throw new MoleculerError(
                        `Failed to fetch catalogue product: ${error.message}`,
                        500,
                        "PRODUCT_FETCH_ERROR"
                    );
                }
            }
        },

        /**
         * Get catalogue information
         */
        getCatalogueInfo: {
            auth: "required",
            params: {
                catalogueId: "string",
                accessToken: "string"
            },
            async handler(ctx) {
                const { catalogueId, accessToken } = ctx.params;

                try {
                    this.logger.info(`Fetching catalogue info: ${catalogueId}`);

                    // Meta Graph API endpoint for fetching catalogue info
                    const url = `https://graph.facebook.com/v18.0/${catalogueId}`;
                    
                    const params = {
                        access_token: accessToken,
                        fields: "id,name,vertical,product_count,created_time,updated_time"
                    };

                    const response = await axios.get(url, { params });

                    if (response.data) {
                        this.logger.info(`Successfully fetched catalogue info: ${response.data.name}`);
                        
                        return {
                            success: true,
                            catalogue: response.data
                        };
                    } else {
                        throw new Error("Catalogue not found");
                    }

                } catch (error) {
                    this.logger.error("Error fetching catalogue info:", error);
                    
                    if (error.response) {
                        const errorData = error.response.data;
                        throw new MoleculerError(
                            `Meta API Error: ${errorData.error?.message || error.message}`,
                            error.response.status,
                            "META_CATALOGUE_INFO_ERROR",
                            { error: errorData }
                        );
                    }
                    
                    throw new MoleculerError(
                        `Failed to fetch catalogue info: ${error.message}`,
                        500,
                        "CATALOGUE_INFO_ERROR"
                    );
                }
            }
        },

        /**
         * Sync Shopify products to Meta catalogue
         * This would typically be called when products are updated in Shopify
         */
        syncShopifyToCatalogue: {
            auth: "required",
            params: {
                catalogueId: "string",
                accessToken: "string",
                shopDomain: "string",
                shopifyAccessToken: "string"
            },
            async handler(ctx) {
                const { catalogueId, accessToken, shopDomain, shopifyAccessToken } = ctx.params;

                try {
                    this.logger.info(`Syncing Shopify products to catalogue: ${catalogueId}`);

                    // First, get products from Shopify
                    const shopifyProducts = await this.getShopifyProducts(shopDomain, shopifyAccessToken);
                    
                    if (!shopifyProducts || shopifyProducts.length === 0) {
                        return {
                            success: true,
                            message: "No products to sync",
                            synced: 0
                        };
                    }

                    // Sync each product to Meta catalogue
                    let syncedCount = 0;
                    const errors = [];

                    for (const product of shopifyProducts) {
                        try {
                            await this.syncProductToCatalogue(catalogueId, accessToken, product);
                            syncedCount++;
                        } catch (error) {
                            errors.push({
                                productId: product.id,
                                error: error.message
                            });
                        }
                    }

                    this.logger.info(`Synced ${syncedCount} products to catalogue`);

                    return {
                        success: true,
                        synced: syncedCount,
                        total: shopifyProducts.length,
                        errors: errors
                    };

                } catch (error) {
                    this.logger.error("Error syncing Shopify to catalogue:", error);
                    throw new MoleculerError(
                        `Failed to sync Shopify products: ${error.message}`,
                        500,
                        "SYNC_ERROR"
                    );
                }
            }
        }
    },

    /**
     * Methods
     */
    methods: {
        /**
         * Get products from Shopify
         */
        async getShopifyProducts(shopDomain, accessToken) {
            try {
                const url = `https://${shopDomain}/admin/api/2023-10/products.json`;
                const response = await axios.get(url, {
                    headers: {
                        'X-Shopify-Access-Token': accessToken,
                        'Content-Type': 'application/json'
                    }
                });

                return response.data.products || [];
            } catch (error) {
                this.logger.error("Error fetching Shopify products:", error);
                throw error;
            }
        },

        /**
         * Sync individual product to Meta catalogue
         */
        async syncProductToCatalogue(catalogueId, accessToken, shopifyProduct) {
            try {
                const url = `https://graph.facebook.com/v18.0/${catalogueId}/products`;
                
                // Transform Shopify product to Meta catalogue format
                const metaProduct = this.transformShopifyToMeta(shopifyProduct);
                
                const response = await axios.post(url, metaProduct, {
                    params: { access_token: accessToken }
                });

                return response.data;
            } catch (error) {
                this.logger.error(`Error syncing product ${shopifyProduct.id}:`, error);
                throw error;
            }
        },

        /**
         * Transform Shopify product to Meta catalogue format
         */
        transformShopifyToMeta(shopifyProduct) {
            return {
                name: shopifyProduct.title,
                description: shopifyProduct.body_html ? 
                    shopifyProduct.body_html.replace(/<[^>]*>/g, '') : shopifyProduct.title,
                retailer_id: shopifyProduct.id.toString(),
                price: shopifyProduct.variants && shopifyProduct.variants[0] ? 
                    shopifyProduct.variants[0].price * 100 : 0, // Convert to cents
                currency: "INR",
                availability: shopifyProduct.status === "active" ? "in stock" : "out of stock",
                condition: "new",
                url: shopifyProduct.handle ? `https://${shopifyProduct.vendor}.myshopify.com/products/${shopifyProduct.handle}` : "",
                image_url: shopifyProduct.images && shopifyProduct.images[0] ? 
                    shopifyProduct.images[0].src : "",
                brand: shopifyProduct.vendor || "Unknown"
            };
        }
    },

    /**
     * Service lifecycle events
     */
    created() {
        this.logger.info("Meta Catalogue service created");
    }
};
