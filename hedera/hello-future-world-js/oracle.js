const {
    mintImpactCredit
} = require("./impact_credit");
const config = require("./config");
const winston = require("winston");
require("dotenv").config();

/**
 * Validates user contributions and triggers Impact Credit minting 
 */

// Logger setup
const logger = winston.createLogger({
    level: "info",
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: "logs/app.log" }),
        new winston.transports.Console()
    ]
});

// Rate limiting for pre-production scalability
const contributionLimits = new Map();
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour
const MAX_CONTRIBUTIONS_PER_HOUR = 100;

/**
 * Validates a contribution and triggers Impact Credit minting
 * @param {Object} contributionData - Contribution details (e.g., type, userId, commitId/proposalId).
 * @param {string} operatorId - The operator's account ID for authentication
* @returns {Promise<void>}
 */
async function validateContribution(
    contributionData,
    operatorId
) {
    try {
        // Validate contribution type
        if (!config.validContributionTypes.includes(contributionData.type)) {
            throw new Error(`Invalid contribution type: ${contributionData.type}`);
        }

        // Validate userId format
        if (!contributionData.userId.match(/^\d+\.\d+\.\d+$/)) {
            throw new Error(`Invalid userId format: ${contributionData.userId}`);
        }

        // Validate required fields based on contribution type
        switch (contributionData.type) {
            case "commit":
                if (!contributionData.commitId) throw new Error("Missing commitId");
                break;
            case "vote":
                if (!contributionData.proposalId) throw new Error("Missing proposalId");
                break;
            case "certificate":
                if (!contributionData.certificateId) throw new Error("Missing certificateId");
                break;
            case "blog":
                if (!contributionData.blogUrl) throw new Error("Missing blogUrl");
                break;
            case "code_review":
                if (!contributionData.reviewId) throw new Error("Missing reviewId");
                break;
            case "bug_report":
                if (!contributionData.bugId) throw new Error("Missing bugId");
                break;
            case "bug_bounty":
                if (!contributionData.bountyId) throw new Error("Missing bountyId");
                break;
            case "hackathon":
                if (!contributionData.hackathonId) throw new Error("Missing hackathonId");
                break;
            default:
                throw new Error("Unsupported contribution type");
        }

        // Apply rate limiting to prevent abuse
        const userId = contributionData.userId;
        const now = Date.now();
        if (!contributionLimits.has(userId)) {
            contributionLimits.set(userId, { count: 0, resetTime: now + RATE_LIMIT_WINDOW});
        }
        const limit = contributionLimits.get(userId);
        if (now > limit.resetTime) {
            limit.count = 0;
            limit.resetTime = now + RATE_LIMIT_WINDOW;
        }
        if (limit.count >= MAX_CONTRIBUTIONS_PER_HOUR) {
            throw new Error(`Rate limit exceeded for user ${userId}`);
        }
        limit.count += 1;

        // Assign credits based on contribution type
        const creditsAwarded = config.creditsPerContribution[contributionData.type];
        logger.info(`Valid contribution: ${JSON.stringify(contributionData)}`);

        // Mint credits
        if (!config.impactCreditTokenId) {
            throw new Error("Impact Credit token ID not set. Run createImpactCreditToken first.");
        }
        await mintImpactCredit(userId, { ...contributionData, creditsAwarded }, operatorId, config.impactCreditTokenId);
        logger.info(`Minted ${creditsAwarded} credits for ${userId}`);
    } catch (error) {
        logger.error(`Validation error for ${JSON.stringify(contributionData)}: ${error.message}`, { error });
        throw error;
    }
}

/**
 * Processes multiple contributions in batch
 * @param {Array<Object>} contributions - List of contribution data
 * @param {string} operatorId - The operator's account ID 
 * @returns {Promise<void>}
 */
async function processContributions(
    contributions,
    operatorId
) {
    try {
        for (const contribution of contributions) {
            await validateContribution(contribution, operatorId);
        }
        logger.info(`Processed ${contributions.length} contributions`);
    } catch (error) {
        logger.error(`Batch processing error: ${error.message}`, { error });
        throw error;
    }
}

// Mock contributions for testing
const mockContributions = [
    { type: "commit", userId: process.env.TEST_USER_ID || "0.0.123456", commitId: "abc123" },
    { type: "vote", userId: process.env.TEST_USER_ID || "0.0.123456", proposalId: "prop456" },
    { type: "certificate", userId: process.env.TEST_USER_ID || "0.0.123456", certificateId: "cert789" },
    { type: "blog", userId: process.env.TEST_USER_ID || "0.0.123456", blogUrl: "https://example.com/blog" },
    { type: "code_review", userId: process.env.TEST_USER_ID || "0.0.123456", reviewId: "rev123" },
    { type: "bug_report", userId: process.env.TEST_USER_ID || "0.0.123456", bugId: "bug456" },
    { type: "bug_bounty", userId: process.env.TEST_USER_ID || "0.0.123456", bountyId: "bounty789" },
    { type: "hackathon", userId: process.env.TEST_USER_ID || "0.0.123456", hackathonId: "hack012" }
];

async function runMockValidation() {
    await processContributions(mockContributions, process.env.OPERATOR_ACCOUNT_ID);
}

if (require.main === module) {
    runMockValidation().catch(console.error);
}

module.exports = { 
    validateContribution, 
    processContributions 
};