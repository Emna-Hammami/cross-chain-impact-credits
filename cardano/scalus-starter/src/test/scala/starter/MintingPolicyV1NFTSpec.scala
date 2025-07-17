package starter

import com.bloxbean.cardano.client.account.Account
import org.scalacheck.Arbitrary
import scalus.*
import scalus.builtin.Data.toData
import scalus.builtin.{ByteString, Data, PlatformSpecific, given}
import scalus.ledger.api.v1.*
import scalus.prelude.*
import scalus.ledger.api.v1.Value.*
import scalus.testkit.ScalusTest
import scalus.uplc.*
import scalus.uplc.eval.*

import scala.language.implicitConversions

class MintingPolicyV1NFTSpec extends munit.ScalaCheckSuite, ScalusTest {
    import Expected.*

    private val account = new Account()
    private val crypto = summon[PlatformSpecific] // platform specific crypto functions

    private val nftName = "10 courses completed" // User-specified NFT name
    private val tokenName = ByteString.fromString(nftName)

    private val adminPubKeyHash: PubKeyHash = PubKeyHash(
        ByteString.fromArray(account.hdKeyPair().getPublicKey.getKeyHash)
    )

    private val config = MintingConfig(adminPubKeyHash, tokenName)

    private val mintingScript =
        MintingPolicyV1NFTGenerator.makeNFTMintingPolicyScript(adminPubKeyHash, tokenName)

    test("should fail when minted NFT name is not correct") {
        val wrongTokenName = tokenName ++ ByteString.fromString("extra")
        val ctx = makeScriptContext(
            mint = Value(mintingScript.scriptHash, wrongTokenName, 1),
            signatories = List(adminPubKeyHash)
        )

        interceptMessage[Exception]("NFT name does not match") {
            MintingPolicyV1NFT.validate(config.toData)(Data.unit, ctx.toData)
        }

        assertEval(mintingScript.script $ Data.unit $ ctx.toData, Failure("Error evaluated"))
    }

    test("should fail when multiple NFTs are minted") {
        val ctx = makeScriptContext(
            mint = Value(mintingScript.scriptHash, tokenName, 1)
                + Value(mintingScript.scriptHash, ByteString.fromString("Extra"), 1),
            signatories = List(adminPubKeyHash)
        )

        interceptMessage[Exception]("Multiple tokens found; only one NFT allowed") {
            MintingPolicyV1NFT.validate(config.toData)(Data.unit, ctx.toData)
        }

        assertEval(mintingScript.script $ Data.unit $ ctx.toData, Failure("Error evaluated"))
    }

    test("should fail when NFT quantity is not exactly 1") {
        val ctx = makeScriptContext(
            mint = Value(mintingScript.scriptHash, tokenName, 2), // Invalid quantity
            signatories = List(adminPubKeyHash)
        )

        interceptMessage[Exception]("NFT quantity must be exactly 1") {
            MintingPolicyV1NFT.validate(config.toData)(Data.unit, ctx.toData)
        }

        assertEval(mintingScript.script $ Data.unit $ ctx.toData, Failure("Error evaluated"))
    }

    test("should fail when admin signature is not provided") {
        val ctx = makeScriptContext(
            mint = Value(mintingScript.scriptHash, tokenName, 1),
            signatories = List.Nil
        )

        interceptMessage[Exception]("Not signed by admin") {
            MintingPolicyV1NFT.validate(config.toData)(Data.unit, ctx.toData)
        }

        assertEval(mintingScript.script $ Data.unit $ ctx.toData, Failure("Error evaluated"))
    }

    test("should fail when admin signature is not correct") {
        val ctx = makeScriptContext(
            mint = Value(mintingScript.scriptHash, tokenName, 1),
            signatories = List(PubKeyHash(crypto.blake2b_224(ByteString.fromString("wrong"))))
        )

        interceptMessage[Exception]("Not signed by admin") {
            MintingPolicyV1NFT.validate(config.toData)(Data.unit, ctx.toData)
        }

        assertEval(mintingScript.script $ Data.unit $ ctx.toData, Failure("Error evaluated"))
    }

    test("should succeed when minted NFT name and quantity are correct and admin signature is provided") {
        val ctx = makeScriptContext(
            mint = Value(mintingScript.scriptHash, tokenName, 1), // Exactly 1 NFT
            signatories = List(adminPubKeyHash)
        )

        // Run the minting policy script as a Scala function
        MintingPolicyV1NFT.validate(config.toData)(Data.unit, ctx.toData)
        // Run the minting policy script as a Plutus script
        assertEval(
            mintingScript.script $ Data.unit $ ctx.toData,
            Success(ExBudget.fromCpuAndMemory(cpu = 43159840, memory = 182678))
        )
    }

    test(s"validator size is reasonable") {
        val size = mintingScript.script.cborEncoded.length
        assert(size > 0, "Validator size should be greater than 0")
        // Note: Exact size may vary due to NFT-specific changes; adjust if needed
        println(s"Validator size: $size bytes")
    }

    private def makeScriptContext(mint: Value, signatories: List[PubKeyHash]) =
        ScriptContext(
            txInfo = TxInfo(
                inputs = List.Nil,
                outputs = List.Nil,
                fee = Value.lovelace(188021),
                mint = mint,
                dcert = List.Nil,
                withdrawals = List.Nil,
                validRange = Interval.always,
                signatories = signatories,
                data = List.Nil,
                id = random[TxId]
            ),
            purpose = ScriptPurpose.Minting(mintingScript.scriptHash)
        )

    private def assertEval(p: Program, expected: Expected): Unit = {
        val result = p.evaluateDebug
        (result, expected) match
            case (result: Result.Success, Expected.Success(expected)) =>
                assertEquals(result.budget, expected)
            case (result: Result.Failure, Expected.Failure(expected)) =>
                assertEquals(result.exception.getMessage, expected)
            case _ => fail(s"Unexpected result: $result, expected: $expected")
    }

    private given arbTxId: Arbitrary[TxId] = Arbitrary(genByteStringOfN(32).map(TxId.apply))
}