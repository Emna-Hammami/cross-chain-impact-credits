const {
    Client,
    AccountId,
    PrivateKey,
    TransactionReceiptQuery,
    TransactionId
} = require("@hashgraph/sdk");
const {
    mintImpactCredit,
    queryCredits,
    createImpactCreditToken
} = require("./impact_credit");
const { validateContribution } = require("./oracle");
const config = require("./config");
require("dotenv").config();

// Get environment variables
const operatorId = process.env.OPERATOR_ACCOUNT_ID;
const operatorKey = process.env.OPERATOR_ACCOUNT_PRIVATE_KEY;
const testUserId = "0.0.123456";

if (!operatorId || !operatorKey) {
    throw new Error("Missing OPERATOR_ACCOUNT_ID or OPERATOR_ACCOUNT_PRIVATE_KEY in .env file");
}

let client;

// Initialize Hedera client
async function initClient() {
    try {
        client = Client.forTestnet().setOperator(
            AccountId.fromString(operatorId),
            PrivateKey.fromStringECDSA(operatorKey)
        );
        console.log("Hedera client initialized with operator:", operatorId);
    } catch (err) {
        console.error("Error initializing client:", err.message);
        throw err;
    }
}

// Wait for transaction finalization and check for errors
async function waitForFinalization(transactionId, action) {
    try {
        console.log(`Waiting for ${action} transaction ${transactionId} finalization...`);
        for (let i = 0; i < 30; i++) { // 30s timeout
            const receipt = await new TransactionReceiptQuery()
                .setTransactionId(TransactionId.fromString(transactionId))
                .execute(client);
            if (receipt.status.toString() === "SUCCESS") {
                console.log(`${action} transaction confirmed: ${transactionId}`);
                return receipt;
            }
            if (receipt.status.toString() !== "SUCCESS") {
                throw new Error(`${action} failed: ${receipt.status.toString()}`);
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        throw new Error(`${action} transaction did not finalize within 30 seconds`);
    } catch (err) {
        console.error(`Error in ${action} transaction:`, err.message);
        throw err;
    }
}

// Test case 0: Create Impact Credit token
async function testCreateImpactCreditToken() {
    try {
        console.log("------Test Create Impact Credit Token-------");

        const tokenId = await createImpactCreditToken();

        await waitForFinalization(tokenId, "Create Token");

        console.log(`Created Impact Credit token: ${tokenId}`);
    } catch (err) {
        console.error("Error in testCreateImpactCreditToken:", err.message);
        throw err;
    }
}

// Test case 1: Mint Impact Credit for commit
async function testMintCommit() {
    try {
        console.log("-----Test Mint Commit-----");

        const contributionData = {
            type: "commit",
            commitId: `commit_${Date.now()}`,
            creditsAwarded: 1
        };

        const tokenId = await mintImpactCredit(testUserId, contributionData, operatorId, config.impactCreditTokenId);
        
        await waitForFinalization(tokenId, "Mint Commit");

        console.log(`Minted Impact Credit for commit: ${tokenId}`);
    } catch (err) {
        console.error("Error in testMintCommit:", err.message);
        throw err;
    }
}

// Test case 2: Mint Impact Credit for vote
async function testMintVote() {
    try {
        console.log("------Test Mint Vote-------");
        
        const contributionData = { 
            type: "vote", 
            proposalId: `prop_${Date.now()}`, 
            creditsAwarded: 5 
        };
        
        const tokenId = await mintImpactCredit(testUserId, contributionData, operatorId, config.impactCreditTokenId);
        
        await waitForFinalization(tokenId, "Mint Vote");
        
        console.log(`Minted Impact Credit for vote: ${tokenId}`);
    } catch (err) {
        console.error("Error in testMintVote:", err.message);
        throw err;
    }
}

// Test case 3: Mint Impact Credit for blog
async function testMintBlog() {
    try {
        console.log("------Test Mint Blog-------");
        
        const contributionData = { 
            type: "blog", 
            blogUrl: `https://example.com/blog_${Date.now()}`, 
            creditsAwarded: 3 
        };
        
        const tokenId = await mintImpactCredit(testUserId, contributionData, operatorId, config.impactCreditTokenId);
        
        await waitForFinalization(tokenId, "Mint Blog");

        console.log(`Minted Impact Credit for blog: ${tokenId}`);
    } catch (err) {
        console.error("Error in testMintBlog:", err.message);
        throw err;
    }
}

// Test case 4: Query user credits
async function testQueryCredits() {
    try {
        console.log("-----Test Query Credits-----");

        const credits = await queryCredits(testUserId);

        if (typeof credits !== "number" || credits < 0) {
            throw new Error(`Invalid credits value: ${credits}`);
        }

        console.log(`Queried credits for ${testUserId}: ${credits}`);

        return credits;
    } catch (err) {
        console.error("Error in testQueryCredits:", err.message);
        throw err;
    }
}

// Test case 5: Validate contribution
async function testValidateContribution() {
    try {
        console.log("-----Test Validate Contribution-----");

        const contributionData = {
            type: "commit",
            userId: testUserId,
            commitId: `commit_${Date.now()}`
        };

        await validateContribution(contributionData, operatorId);

        console.log(`Validated contribution: ${JSON.stringify(contributionData)}`);
    } catch (err) {
        console.error("Error in testValidateContribution:", err.message);
        throw err;
    }
}

// Critical scenario 1: Attempt to mint with duplicate contribution ID
async function testDuplicateContribution() {
    try {
        console.log("-----Test Duplicate Contribution-----");

        const commitId = `commit_duplicate_${Date.now()}`;
        const contributionData = { 
            type: "commit", 
            commitId, 
            creditsAwarded: 1 
        };
        await mintImpactCredit(testUserId, contributionData, operatorId, config.impactCreditTokenId);
        await waitForFinalization(TransactionId.fromString(operatorId), "Mint First Commit");

        await mintImpactCredit(testUserId, contributionData, operatorId, config.impactCreditTokenId); // Duplicate
        throw new Error("Expected duplicate contribution to fail");
    } catch (err) {
        console.log("Successfully caught duplicate contribution failure:", err.message);
    }
}

// Critical scenario 2: Attempt to mint with invalid user ID
async function testInvalidUserId() {
    try {
        console.log("------Test Invalid User ID-------");

        const contributionData = { 
            type: "commit", 
            commitId: `commit_${Date.now()}`, 
            creditsAwarded: 1 
        };

        await mintImpactCredit("invalid", contributionData, operatorId, config.impactCreditTokenId);
        throw new Error("Expected invalid user ID to fail");
    } catch (err) {
        if (err.message.includes("Invalid receiver account ID")) {
            console.log("Successfully caught invalid user ID error:", err.message);
        } else {
            console.error("Unexpected error in testInvalidUserId:", err.message);
            throw err;
        }
    }
}

// Critical scenario 3: Attempt to mint with unauthorized operator
async function testUnauthorizedOperator() {
    try {
        console.log("------Test Unauthorized Operator-------");

        const contributionData = { 
            type: "commit", 
            commitId: `commit_${Date.now()}`, 
            creditsAwarded: 1 
        };

        await mintImpactCredit(testUserId, contributionData, "0.0.999", config.impactCreditTokenId);
        throw new Error("Expected unauthorized operator to fail");
    } catch (err) {
        if (err.message.includes("Unauthorized operator")) {
            console.log("Successfully caught unauthorized operator error:", err.message);
        } else {
            console.error("Unexpected error in testUnauthorizedOperator:", err.message);
            throw err;
        }
    }
}

// Critical scenario 4: Attempt to validate with missing required field
async function testMissingRequiredField() {
    try {
        console.log("------Test Missing Required Field-------");

        const contributionData = { 
            type: "bug_bounty", 
            userId: testUserId 
        }; // Missing bountyId

        await validateContribution(contributionData, operatorId);
        throw new Error("Expected missing required field to fail");
    } catch (err) {
        if (err.message.includes("Missing bountyId")) {
            console.log("Successfully caught missing required field error:", err.message);
        } else {
            console.error("Unexpected error in testMissingRequiredField:", err.message);
            throw err;
        }
    }
}

// Critical scenario 5: Attempt to exceed rate limit
async function testRateLimit() {
    try {
        console.log("------Test Rate Limit-------");
        
        const contributionData = { 
            type: "commit", 
            userId: testUserId, 
            commitId: "" 
        };

        for (let i = 0; i < 101; i++) {
            contributionData.commitId = `commit_rate_${i}_${Date.now()}`;
            await validateContribution(contributionData, operatorId);
        }

        throw new Error("Expected rate limit to fail");
    } catch (err) {
        if (err.message.includes("Rate limit exceeded")) {
            console.log("Successfully caught rate limit error:", err.message);
        } else {
            console.error("Unexpected error in testRateLimit:", err.message);
            throw err;
        }
    }
}

async function main() {
    try {
        await initClient();

        // Happy path tests
        await testCreateImpactCreditToken();
        await testMintCommit();
        await testMintVote();
        await testMintBlog();
        await testQueryCredits();
        await testValidateContribution();

        // Critical scenarios
        await testDuplicateContribution();
        await testInvalidUserId();
        await testUnauthorizedOperator();
        await testMissingRequiredField();
        await testRateLimit();

        console.log("All tests completed successfully!");
    } catch (err) {
        console.error("An error occurred:", err);
        process.exit(1);
    }
}

main();