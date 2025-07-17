const { 
    Client, 
    TopicCreateTransaction, 
    AccountId, 
    PrivateKey 
} = require("@hashgraph/sdk");
require("dotenv").config();

async function createTopic() {
    try {
        const operatorId = process.env.OPERATOR_ACCOUNT_ID;
        const operatorKey = process.env.OPERATOR_ACCOUNT_PRIVATE_KEY;

        if (!operatorId || !operatorKey) {
            throw new Error("Missing OPERATOR_ACCOUNT_ID or OPERATOR_ACCOUNT_PRIVATE_KEY in .env file");
        }

        const client = Client.forTestnet().setOperator(
            AccountId.fromString(operatorId),
            PrivateKey.fromStringECDSA(operatorKey)
        );

        const tx = await new TopicCreateTransaction()
            .setMaxTransactionFee(1_000_000_000) // 1 HBAR
            .setTopicMemo("Cross-Chain Impact Credits HCS Topic")
            .execute(client);

        const topicId = (await tx.getReceipt(client)).topicId;
        console.log("HCS Topic ID:", topicId.toString());
        console.log("Add this to your .env file: HCS_TOPIC_ID=" + topicId.toString());
    } catch (error) {
        console.error("Error creating HCS topic:", error.message);
        process.exit(1);
    }
}

createTopic();