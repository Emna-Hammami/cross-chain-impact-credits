package starter

import com.bloxbean.cardano.client.plutus.spec.{PlutusScript, PlutusV1Script}
import scalus.*
import scalus.Compiler.compile
import scalus.builtin.Data.toData
import scalus.builtin.{ByteString, Data}
import scalus.ledger.api.v1.*
import scalus.prelude.{*, given}
import scalus.sir.SIR
import scalus.uplc.Program

/* This annotation is used to generate the Scalus Intermediate Representation (SIR)
   for the code in the annotated object.
 */
@Compile
/** NFT Minting policy script
 */
object MintingPolicyV1NFT {

    def validate(config: Data)(redeemer: Data, contextData: Data): Unit = {
        val sc = contextData.to[ScriptContext]
        sc.purpose match
            case ScriptPurpose.Minting(currencySymbol) =>
                val mintingConfig = config.to[MintingConfig]
                mintingPolicy(
                    mintingConfig.adminPubKeyHash,
                    mintingConfig.tokenName,
                    currencySymbol,
                    sc.txInfo
                )
            case _ =>
                fail("Only for minting")
    }

    /** NFT Minting policy script
     *
     * @param adminPubKeyHash
     *   admin public key hash
     * @param tokenName
     *   NFT name to mint (exactly one token)
     * @param ownSymbol
     *   own currency symbol (minting policy id)
     * @param tx
     *   transaction information
     */
    private def mintingPolicy(
                                 adminPubKeyHash: PubKeyHash, // admin pub key hash
                                 tokenName: TokenName, // NFT name
                                 ownSymbol: CurrencySymbol,
                                 tx: TxInfo
                             ): Unit = {
        // find the tokens minted by this policy id
        val mintedTokens = tx.mint.get(ownSymbol).getOrFail("NFT not found")
        mintedTokens.toList match
            // there should be exactly one NFT with the given name and quantity 1
            case List.Cons((tokName, quantity), tail) =>
                tail match
                    case List.Nil =>
                        require(tokName == tokenName, "NFT name does not match")
                        require(quantity == BigInt(1), "NFT quantity must be exactly 1")
                    case _ => fail("Multiple tokens found; only one NFT allowed")
            case _ => fail("Impossible: no NFT found")

        // only admin can mint the NFT
        require(tx.signatories.contains(adminPubKeyHash), "Not signed by admin")
    }
}

object MintingPolicyV1NFTGenerator {
    val mintingPolicySIR: SIR = compile(MintingPolicyV1NFT.validate)
    private val script = mintingPolicySIR.toUplc(generateErrorTraces = true).plutusV1

    /** Generate an NFT minting policy script with a specified NFT name
     *
     * @param adminPubKeyHash Admin public key hash
     * @param nftName User-specified NFT name as a string
     * @return MintingPolicyV1NFTScript instance
     */
    def makeNFTMintingPolicyScript(
                                      adminPubKeyHash: PubKeyHash,
                                      nftName: TokenName
                                  ): MintingPolicyV1NFTScript = {
        val config = MintingConfig(adminPubKeyHash = adminPubKeyHash, tokenName = nftName)
        MintingPolicyV1NFTScript(script = script $ config.toData)
    }
}

class MintingPolicyV1NFTScript(val script: Program) extends MintingScript {
    lazy val plutusScript: PlutusScript = PlutusV1Script
        .builder()
        .`type`("PlutusScriptV1")
        .cborHex(script.doubleCborHex)
        .build()
}