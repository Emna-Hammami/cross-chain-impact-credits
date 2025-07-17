const {
    Client,
    TokenCreateTransaction,
    TokenType,
    TokenMintTransaction,
    TopicMessageSubmitTransaction,
    AccountId,
    PrivateKey,
    AccountBalanceQuery,
    StatusError
} = require("@hashgraph/sdk");
const winston = require("winston");
const config = require("./config");
require("dotenv").config();

/**
 * Manages soulbound Impact Credit minting using Hedera Token Service (HTS) and logs contribution events to Hedera Consensus Service (HCS)
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
        new winston.transports.Console() // Log to console for debugging
    ]
});

/**
 * Creates a soulbound Impact Credit token. Run once during setup
 * @returns {Promise<string>} - The created token ID
 */
async function createImpactCreditToken() {
    try {
        // Initialize Hedera Client
        const client = Client.forTestnet().setOperator(
            AccountId.fromString(process.env.OPERATOR_ACCOUNT_ID), 
            PrivateKey.fromStringECDSA(process.env.OPERATOR_ACCOUNT_PRIVATE_KEY)
        );

        // Create a new souldbound token
        const tokenTx = await new TokenCreateTransaction()
            .setTokenName("Impact Credit")
            .setTokenSymbol("IMPC")
            .setTokenType(TokenType.NonFungibleUnique)
            .setTreasuryAccountId(process.env.OPERATOR_ACCOUNT_ID)
            .setSupplyKey(PrivateKey.fromStringECDSA(process.env.OPERATOR_ACCOUNT_PRIVATE_KEY))
            .setAdminKey(PrivateKey.fromStringECDSA(process.env.OPERATOR_ACCOUNT_PRIVATE_KEY))
            .setDecimals(0)
            .setInitialSupply(0)
            .setTokenMemo("Cross-Chain Impact Credits Project")
            .setMaxTransactionFee(10000000000) // 10 HBAR
            .execute(client);
        const tokenReceipt = await tokenTx.getReceipt(client);
        const tokenId = tokenReceipt.tokenId.toString();
        config.setImpactCreditTokenId(tokenId); // Store in config
        logger.info(`Created token: ${tokenId}`);
        return tokenId;
    } catch (error) {
        logger.error(`Error creating Impact Credit token: ${error.message}`, { error });
        throw error;
    }
}

/**
 * Mints a soulbound Impact Credit and logs the contribution event to HCS.
 * @param {string} receiverId - The Hedera account ID of the contributor
 * @param {Object} contributionData - Contribution details 
 * @param {string} operatorId - The operator's account ID for authentication
 * @param {string} tokenId - The existing token ID to mint
 * @returns {Promise<string>} - The transaction ID of the minting operation
 */
async function mintImpactCredit(
    receiverId,
    contributionData,
    operatorId,
    tokenId
) {
    try {
        // Validate inputs
        if (!AccountId.fromString(receiverId)) {
            throw new Error("Invalid receiver account ID");
        }
        if (!contributionData.type || !contributionData.creditsAwarded) {
            throw new Error("Invalid contribution data");
        }
        if (operatorId !== process.env.OPERATOR_ACCOUNT_ID) {
            throw new Error("Unauthorized operator");
        }
        if (!tokenId) {
            throw new Error("Token ID is required");
        }

        // Initialize Hedera Client
        const client = Client.forTestnet().setOperator(
            AccountId.fromString(process.env.OPERATOR_ACCOUNT_ID), 
            PrivateKey.fromStringECDSA(process.env.OPERATOR_ACCOUNT_PRIVATE_KEY)
        );

        // Mint one Impact Credit to receiver
        const mintTx = await new TokenMintTransaction()
            .setTokenId(tokenId)
            .setMetadata([Buffer.from(JSON.stringify(contributionData))])
            .execute(client);
        const mintTxId = mintTx.transactionId.toString();

        // Log event to HCS for transparency and relayer integration
        const hcsTx = await new TopicMessageSubmitTransaction()
            .setTopicId(process.env.HCS_TOPIC_ID)
            .setMessage(JSON.stringify({
                receiver: receiverId,
                contribution: contributionData,
                credits: contributionData.creditsAwarded,
                cumulativeCredits: await queryCredits(receiverId), // For relayer milestone detection
                timestamp: Date.now(),
                tokenId,
                operatorId,
                transactionId: mintTxId
            }))
            .execute(client);

        logger.info(`Minted IMPC: ${tokenId}, Event: ${hcsTx.transactionId}, Receiver: ${receiverId}`);
        return mintTxId;
    } catch (error) {
        logger.error(`Error minting Impact Credit for ${receiverId}: ${error.message}`, { error });
        throw error;
    }
}

/**
 * Queries the total Impact Credits for a user
 * @param {string} accountId - The Hedera account ID
 * @returns {Promise<number>} - The number of credits
 */
async function queryCredits(
    accountId
) {
    try {
        const client = Client.forTestnet().setOperator(
            AccountId.fromString(process.env.OPERATOR_ACCOUNT_ID),
            PrivateKey.fromStringECDSA(process.env.OPERATOR_ACCOUNT_PRIVATE_KEY)
        );

        // Query token balance for specific Impact Credit token
        const balance = await new AccountBalanceQuery()
            .setAccountId(accountId)
            .execute(client);
        const credits = balance.tokens.get(process.env.IMPACT_CREDIT_TOKEN_ID) || 0;
        
        logger.info(`Queried credits for ${accountId}: ${credits}`);
        return parseInt(credits);
    } catch (error) {
        logger.error(`Error querying credits for ${accountId}: ${error.message}`, { error });
        return 0;
    }
}

module.exports = {
    mintImpactCredit,
    queryCredits,
    createImpactCreditToken
};