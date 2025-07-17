/**
 * Centralizes configuration settings for the Hedera layer, 
 * including valid contribution types and credits awarded, 
 * to ensure consistency and ease of maintenance.
 */

module.exports = {
    // Valid contribution types for Impact Credits
    validContributionTypes: [
        "commit",
        "vote",
        "certificate",
        "blog",
        "code_review",
        "bug_report",
        "bug_bounty",
        "hackathon"
    ],
    // Credits awarded per contribution type
    creditsPerContribution: {
        commit: 1, // GitHub commit
        vote: 5, // DAO vote
        certificate: 10, // Earning a certificate
        blog: 3, // Publishing a blog post
        code_review: 2, // Performing a code review
        bug_report: 4, // Submitting a verified bug report
        bug_bounty: 6, // Participating in a bug bounty program
        hackathon: 8 // Participating in a hackathon
    },
    // HCS topic ID for event logging
    hcsTopicId: process.env.HCS_TOPIC_ID,
    impactCreditTokenId: null, // Set by createImpactCreditToken
    setImpactCreditTokenId(tokenId) {
        this.impactCreditTokenId = tokenId;
    }
};