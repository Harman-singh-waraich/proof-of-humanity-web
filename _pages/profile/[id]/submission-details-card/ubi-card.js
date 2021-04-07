import { Button, Card, Text, useContract, useWeb3 } from "@kleros/components";
import { UBI } from "@kleros/icons";
import { useEffect, useMemo, useReducer } from "react";

import { submissionStatusEnum } from "data";
import ProofOfHumanityAbi from "subgraph/abis/proof-of-humanity";
import UBIAbi from "subgraph/abis/ubi";
import { UBIAddress, address as pohAddress } from "subgraph/config";

function AccruedUBI({ lastMintedSecond, web3, accruedPerSecond }) {
  const [, rerender] = useReducer(() => ({}), {});
  useEffect(() => {
    const timeout = setInterval(() => rerender(), 1000);
    return () => clearInterval(timeout);
  }, []);

  let accruedUBI;
  if (lastMintedSecond)
    if (lastMintedSecond.eq(web3.utils.toBN(0))) accruedUBI = lastMintedSecond;
    else if (accruedPerSecond)
      accruedUBI = web3.utils
        .toBN(Math.floor(Date.now() / 1000))
        .sub(lastMintedSecond)
        .mul(accruedPerSecond);

  return <Text>{accruedUBI && `${web3.utils.fromWei(accruedUBI)} UBI`}</Text>;
}
export default function UBICard({
  submissionID,
  lastStatusChange,
  challengePeriodDuration,
  status,
}) {
  const { web3 } = useWeb3();
  const [accounts] = useWeb3("eth", "getAccounts");

  const [lastMintedSecond, , lastMintedSecondStatus, reCall] = useContract(
    "UBI",
    "accruedSince",
    useMemo(() => ({ args: [submissionID] }), [submissionID])
  );
  const [registered] = useContract(
    "proofOfHumanity",
    "isRegistered",
    useMemo(() => ({ args: [submissionID] }), [submissionID])
  );
  const [accruedPerSecond] = useContract("UBI", "accruedPerSecond");

  const { send: batchSend, loading: batchSendLoading } = useContract(
    "transactionBatcher",
    "batchSend"
  );
  const { send: reportRemoval, loading: reportRemovalLoading } = useContract(
    "UBI",
    "reportRemoval"
  );

  const pohData = useMemo(() => {
    if (!ProofOfHumanityAbi || !submissionID) return;
    const poHInstance = new web3.eth.Contract(ProofOfHumanityAbi);
    return poHInstance.methods.executeRequest(submissionID).encodeABI();
  }, [submissionID, web3.eth.Contract]);

  const ubiData = useMemo(() => {
    if (!UBIAbi || !submissionID) return;
    const ubiInstance = new web3.eth.Contract(UBIAbi);
    return ubiInstance.methods.startAccruing(submissionID).encodeABI();
  }, [submissionID, web3.eth.Contract]);

  const challengeTimeRemaining =
    (Number(lastStatusChange) + Number(challengePeriodDuration)) * 1000 -
    Date.now();

  return (
    <Card
      variant="muted"
      mainSx={{ justifyContent: "space-between", padding: 1 }}
    >
      <UBI size={32} />
      <AccruedUBI
        lastMintedSecond={lastMintedSecond}
        web3={web3}
        accruedPerSecond={accruedPerSecond}
      />
      {accounts &&
        accounts[0]?.toLowerCase() === submissionID &&
        lastMintedSecond &&
        typeof registered === "boolean" &&
        !registered && (
          <Button
            variant="secondary"
            disabled={lastMintedSecondStatus === "pending"}
            onClick={() => reportRemoval(submissionID).then(reCall)}
            loading={reportRemovalLoading}
          >
            Seize UBI
          </Button>
        )}
      {status.key === submissionStatusEnum.PendingRegistration.key &&
        challengeTimeRemaining < 0 && (
          <Button
            variant="secondary"
            Disabled={lastMintedSecondStatus === "pending"}
            onClick={() =>
              batchSend(
                [pohAddress, UBIAddress],
                [web3.utils.toBN(0), web3.utils.toBN(0)],
                [pohData, ubiData],
                { gasLimit: 150000 }
              ).then(reCall)
            }
            Loading={batchSendLoading}
          >
            Start Accruing
          </Button>
        )}
    </Card>
  );
}
