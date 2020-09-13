import { Address, BigInt, ByteArray, crypto } from "@graphprotocol/graph-ts";
import {
  AddSubmissionCall,
  AddSubmissionManuallyCall,
  AddVouchCall,
  ArbitratorComplete,
  ChallengeRequestCall,
  ChangeArbitratorCall,
  ChangeChallengePeriodDurationCall,
  ChangeGovernorCall,
  ChangeLoserStakeMultiplierCall,
  ChangeMetaEvidenceCall,
  ChangeRenewalTimeCall,
  ChangeRequiredNumberOfVouchesCall,
  ChangeSharedStakeMultiplierCall,
  ChangeStateToPendingCall,
  ChangeSubmissionBaseDepositCall,
  ChangeSubmissionChallengeBaseDepositCall,
  ChangeSubmissionDurationCall,
  ChangeWinnerStakeMultiplierCall,
  ExecuteRequestCall,
  FundAppealCall,
  FundSubmissionCall,
  MetaEvidence as MetaEvidenceEvent,
  ProcessVouchesCall,
  ProofOfHumanity,
  ReapplySubmissionCall,
  RemoveSubmissionCall,
  RemoveSubmissionManuallyCall,
  RemoveVouchCall,
  RuleCall,
  WithdrawFeesAndRewardsCall,
  WithdrawSubmissionCall,
} from "../generated/ProofOfHumanity/ProofOfHumanity";
import {
  Challenge,
  Contract,
  Contribution,
  Evidence,
  MetaEvidence,
  Request,
  Round,
  Submission,
} from "../generated/schema";

function getStatus(reason: number): string {
  if (reason == 0) return "None";
  if (reason == 1) return "Vouching";
  if (reason == 2) return "PendingRegistration";
  if (reason == 3) return "PendingRemoval";
  return "Error";
}

function getReason(reason: number): string {
  if (reason == 0) return "None";
  if (reason == 1) return "IncorrectSubmission";
  if (reason == 2) return "Deceased";
  if (reason == 3) return "Duplicate";
  if (reason == 4) return "DoesNotExist";
  return "Error";
}

function concatByteArrays(a: ByteArray, b: ByteArray): ByteArray {
  let out = new Uint8Array(a.length + b.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i];
  for (let j = 0; j < b.length; j++) out[a.length + j] = b[j];
  return out as ByteArray;
}

function updateContribution(
  proofOfHumanityAddress: Address,
  submissionID: Address,
  requestIndex: BigInt,
  challengeIndex: BigInt,
  roundIndex: BigInt,
  roundID: ByteArray,
  contributor: Address
): void {
  let proofOfHumanity = ProofOfHumanity.bind(proofOfHumanityAddress);
  let roundInfo = proofOfHumanity.getRoundInfo(
    submissionID,
    requestIndex,
    challengeIndex,
    roundIndex
  );
  let contributions = proofOfHumanity.getContributions(
    submissionID,
    requestIndex,
    challengeIndex,
    roundIndex,
    contributor
  );

  let round = Round.load(roundID.toHexString());
  round.paidFees = roundInfo.value1;
  round.hasPaid = roundInfo.value2;
  round.feeRewards = roundInfo.value3;
  round.save();

  let contributionID = crypto
    .keccak256(concatByteArrays(roundID, contributor))
    .toHexString();
  let contribution = Contribution.load(contributionID);
  if (contribution == null) contribution = new Contribution(contributionID);
  contribution.round = round.id;
  contribution.contributor = contributor;
  contribution.values = [contributions[1], contributions[2]];
  contribution.save();
}

function requestStatusChange(
  submissionID: Address,
  timestamp: BigInt,
  msgSender: Address,
  evidenceURI: string,
  proofOfHumanityAddress: Address
): void {
  let contract = Contract.load("0");
  let submission = Submission.load(submissionID.toHexString());

  let requestID = crypto.keccak256(
    concatByteArrays(
      submissionID,
      ByteArray.fromUTF8(submission.requestsLength.toString())
    )
  );
  submission.requestsLength = submission.requestsLength.plus(new BigInt(1));
  submission.save();

  let request = new Request(requestID.toHexString());
  request.submission = submission.id;
  request.disputed = false;
  request.lastStatusChange = timestamp;
  request.resolved = false;
  request.requester = msgSender;
  request.arbitrator = contract.arbitrator;
  request.arbitratorExtraData = contract.arbitratorExtraData;
  request.vouches = [];
  request.usedReasons = [];
  request.currentReason = "None";
  request.nbParallelDisputes = new BigInt(0);
  request.requesterLost = false;
  request.penaltyIndex = new BigInt(0);
  request.metaEvidence =
    submission.status === "PendingRemoval"
      ? contract.clearingMetaEvidence
      : contract.registrationMetaEvidence;
  request.evidenceLength = new BigInt(1);
  request.challengesLength = new BigInt(1);
  request.save();

  let evidence = new Evidence(
    crypto
      .keccak256(concatByteArrays(requestID, ByteArray.fromUTF8("Evidence-0")))
      .toHexString()
  );
  evidence.request = request.id;
  evidence.URI = evidenceURI;
  evidence.sender = msgSender;
  evidence.save();

  let challengeID = crypto.keccak256(
    concatByteArrays(requestID, ByteArray.fromUTF8("Challenge-0"))
  );
  let challenge = new Challenge(challengeID.toHexString());
  challenge.request = request.id;
  challenge.roundsLength = new BigInt(1);
  challenge.save();

  let roundID = crypto.keccak256(
    concatByteArrays(challengeID, ByteArray.fromUTF8("0"))
  );
  let round = new Round(roundID.toHexString());
  round.challenge = challenge.id;
  round.paidFees = [new BigInt(0), new BigInt(0)];
  round.hasPaid = [false, false];
  round.feeRewards = new BigInt(0);
  round.save();

  updateContribution(
    proofOfHumanityAddress,
    submissionID,
    submission.requestsLength.minus(new BigInt(1)),
    new BigInt(0),
    new BigInt(0),
    roundID,
    msgSender
  );
}

export function metaEvidence(event: MetaEvidenceEvent): void {
  let metaEvidence = new MetaEvidence(event.params._metaEvidenceID.toString());
  metaEvidence.URI = event.params._evidence;
  metaEvidence.save();

  let contract = Contract.load("0");
  if (contract == null) return;
  contract.metaEvidenceUpdates = contract.metaEvidenceUpdates.plus(
    new BigInt(1)
  );
  if (event.params._metaEvidenceID.mod(new BigInt(2)).equals(new BigInt(0)))
    contract.registrationMetaEvidence = metaEvidence.id;
  else contract.clearingMetaEvidence = metaEvidence.id;
  contract.save();
}

export function arbitratorComplete(event: ArbitratorComplete): void {
  let proofOfHumanity = ProofOfHumanity.bind(event.address);
  let contract = new Contract("0");
  contract.arbitrator = event.params.arbitrator;
  contract.arbitratorExtraData = proofOfHumanity.arbitratorExtraData();
  contract.governor = event.params.governor;
  contract.submissionBaseDeposit = event.params.submissionBaseDeposit;
  contract.submissionChallengeBaseDeposit =
    event.params.submissionChallengeBaseDeposit;
  contract.submissionDuration = event.params.submissionDuration;
  contract.renewalTime = proofOfHumanity.renewalTime();
  contract.challengePeriodDuration = event.params.challengePeriodDuration;
  contract.requiredNumberOfVouches = event.params.requiredNumberOfVouches;
  contract.metaEvidenceUpdates = new BigInt(0);
  contract.sharedStakeMultiplier = event.params.sharedStakeMultiplier;
  contract.winnerStakeMultiplier = event.params.winnerStakeMultiplier;
  contract.loserStakeMultiplier = event.params.loserStakeMultiplier;
  contract.registrationMetaEvidence = "0x0";
  contract.clearingMetaEvidence = "0x1";
  contract.save();
}

export function addSubmissionManually(call: AddSubmissionManuallyCall): void {
  let contract = Contract.load("0");
  let submission = new Submission(call.inputs._submissionID.toHexString());
  submission.status = "None";
  submission.registered = true;
  submission.submissionTime = call.block.timestamp;
  submission.renewalTimestamp = call.block.timestamp.plus(
    contract.submissionDuration.minus(contract.renewalTime)
  );
  submission.name = call.inputs._name;
  submission.bio = call.inputs._bio;
  submission.vouchees = [];
  submission.requestsLength = new BigInt(1);
  submission.save();

  let requestID = crypto.keccak256(
    concatByteArrays(call.inputs._submissionID, ByteArray.fromUTF8("0"))
  );
  let request = new Request(requestID.toHexString());
  request.submission = submission.id;
  request.disputed = false;
  request.lastStatusChange = call.block.timestamp;
  request.resolved = true;
  request.requester = call.from;
  request.arbitrator = contract.arbitrator;
  request.arbitratorExtraData = contract.arbitratorExtraData;
  request.vouches = [];
  request.usedReasons = [];
  request.currentReason = "None";
  request.nbParallelDisputes = new BigInt(0);
  request.requesterLost = false;
  request.penaltyIndex = new BigInt(0);
  request.metaEvidence = contract.registrationMetaEvidence;
  request.evidenceLength = new BigInt(1);
  request.challengesLength = new BigInt(1);
  request.save();

  let evidence = new Evidence(
    crypto
      .keccak256(concatByteArrays(requestID, ByteArray.fromUTF8("Evidence-0")))
      .toHexString()
  );
  evidence.request = request.id;
  evidence.URI = call.inputs._evidence;
  evidence.sender = call.from;
  evidence.save();

  let challengeID = crypto.keccak256(
    concatByteArrays(requestID, ByteArray.fromUTF8("Challenge-0"))
  );
  let challenge = new Challenge(challengeID.toHexString());
  challenge.request = request.id;
  challenge.roundsLength = new BigInt(1);
  challenge.save();

  let round = new Round(
    crypto
      .keccak256(concatByteArrays(challengeID, ByteArray.fromUTF8("0")))
      .toHexString()
  );
  round.challenge = challenge.id;
  round.paidFees = [new BigInt(0), new BigInt(0)];
  round.hasPaid = [false, false];
  round.feeRewards = new BigInt(0);
  round.save();
}

export function removeSubmissionManually(
  call: RemoveSubmissionManuallyCall
): void {
  let submission = Submission.load(call.inputs._submissionID.toHexString());
  submission.registered = false;
  submission.save();
}

export function changeSubmissionBaseDeposit(
  call: ChangeSubmissionBaseDepositCall
): void {
  let contract = Contract.load("0");
  contract.submissionBaseDeposit = call.inputs._submissionBaseDeposit;
  contract.save();
}

export function changeSubmissionChallengeBaseDeposit(
  call: ChangeSubmissionChallengeBaseDepositCall
): void {
  let contract = Contract.load("0");
  contract.submissionChallengeBaseDeposit =
    call.inputs._submissionChallengeBaseDeposit;
  contract.save();
}

export function changeSubmissionDuration(
  call: ChangeSubmissionDurationCall
): void {
  let contract = Contract.load("0");
  contract.submissionDuration = call.inputs._submissionDuration;
  contract.save();
}

export function changeRenewalTime(call: ChangeRenewalTimeCall): void {
  let contract = Contract.load("0");
  contract.renewalTime = call.inputs._renewalTime;
  contract.save();
}

export function changeChallengePeriodDuration(
  call: ChangeChallengePeriodDurationCall
): void {
  let contract = Contract.load("0");
  contract.challengePeriodDuration = call.inputs._challengePeriodDuration;
  contract.save();
}

export function changeRequiredNumberOfVouches(
  call: ChangeRequiredNumberOfVouchesCall
): void {
  let contract = Contract.load("0");
  contract.requiredNumberOfVouches = call.inputs._requiredNumberOfVouches;
  contract.save();
}

export function changeSharedStakeMultiplier(
  call: ChangeSharedStakeMultiplierCall
): void {
  let contract = Contract.load("0");
  contract.sharedStakeMultiplier = call.inputs._sharedStakeMultiplier;
  contract.save();
}

export function changeWinnerStakeMultiplier(
  call: ChangeWinnerStakeMultiplierCall
): void {
  let contract = Contract.load("0");
  contract.winnerStakeMultiplier = call.inputs._winnerStakeMultiplier;
  contract.save();
}

export function changeLoserStakeMultiplier(
  call: ChangeLoserStakeMultiplierCall
): void {
  let contract = Contract.load("0");
  contract.loserStakeMultiplier = call.inputs._loserStakeMultiplier;
  contract.save();
}

export function changeGovernor(call: ChangeGovernorCall): void {
  let contract = Contract.load("0");
  contract.governor = call.inputs._governor;
  contract.save();
}

export function changeMetaEvidence(call: ChangeMetaEvidenceCall): void {
  let contract = Contract.load("0");
  contract.metaEvidenceUpdates = contract.metaEvidenceUpdates.plus(
    new BigInt(1)
  );

  let registrationMetaEvidenceID = contract.metaEvidenceUpdates.times(
    new BigInt(2)
  );
  let registrationMetaEvidence = new MetaEvidence(
    registrationMetaEvidenceID.toHexString()
  );
  registrationMetaEvidence.URI = call.inputs._registrationMetaEvidence;
  registrationMetaEvidence.save();

  let clearingMetaEvidence = new MetaEvidence(
    registrationMetaEvidenceID.plus(new BigInt(1)).toHexString()
  );
  clearingMetaEvidence.URI = call.inputs._clearingMetaEvidence;
  clearingMetaEvidence.save();

  contract.registrationMetaEvidence = registrationMetaEvidence.id;
  contract.clearingMetaEvidence = clearingMetaEvidence.id;
  contract.save();
}

export function changeArbitrator(call: ChangeArbitratorCall): void {
  let contract = Contract.load("0");
  contract.arbitrator = call.inputs._arbitrator;
  contract.arbitratorExtraData = call.inputs._arbitratorExtraData;
  contract.save();
}

export function addSubmission(call: AddSubmissionCall): void {
  let submissionID = call.from.toHexString();
  let submission = Submission.load(submissionID);
  if (submission == null) {
    submission = new Submission(submissionID);
    submission.registered = false;
    submission.name = call.inputs._name;
    submission.bio = call.inputs._bio;
    submission.vouchees = [];
    submission.requestsLength = new BigInt(0);
  }
  submission.status = "Vouching";
  submission.save();

  requestStatusChange(
    call.from,
    call.block.timestamp,
    call.from,
    call.inputs._evidence,
    call.to
  );
}

export function reapplySubmission(call: ReapplySubmissionCall): void {
  let submission = Submission.load(call.from.toHexString());
  submission.status = "Vouching";
  submission.save();

  requestStatusChange(
    call.from,
    call.block.timestamp,
    call.from,
    call.inputs._evidence,
    call.to
  );
}

export function removeSubmission(call: RemoveSubmissionCall): void {
  let submission = Submission.load(call.inputs._submissionID.toHexString());
  submission.status = "PendingRemoval";
  submission.save();

  requestStatusChange(
    call.inputs._submissionID,
    call.block.timestamp,
    call.from,
    call.inputs._evidence,
    call.to
  );
}

export function fundSubmission(call: FundSubmissionCall): void {
  let submission = Submission.load(call.inputs._submissionID.toHexString());
  let requestIndex = submission.requestsLength.minus(new BigInt(1));
  let requestID = crypto.keccak256(
    concatByteArrays(
      call.inputs._submissionID,
      ByteArray.fromUTF8(requestIndex.toString())
    )
  );
  let challengeID = crypto.keccak256(
    concatByteArrays(requestID, ByteArray.fromUTF8("Challenge-0"))
  );
  let roundID = crypto.keccak256(
    concatByteArrays(challengeID, ByteArray.fromUTF8("0"))
  );
  updateContribution(
    call.to,
    call.inputs._submissionID,
    requestIndex,
    new BigInt(0),
    new BigInt(0),
    roundID,
    call.from
  );
}

export function addVouch(call: AddVouchCall): void {
  let submission = Submission.load(call.from.toHexString());
  if (submission != null) {
    submission.vouchees = submission.vouchees.concat([
      call.inputs._submissionID.toHexString(),
    ]);
    submission.save();
  }
}

export function removeVouch(call: RemoveVouchCall): void {
  let submission = Submission.load(call.from.toHexString());
  if (submission != null) {
    submission.vouchees = submission.vouchees.filter(
      (vouchee) => vouchee != call.inputs._submissionID.toHexString()
    );
    submission.save();
  }
}

export function withdrawSubmission(call: WithdrawSubmissionCall): void {
  let submission = Submission.load(call.from.toHexString());
  submission.status = "None";
  submission.save();

  let requestIndex = submission.requestsLength.minus(new BigInt(1));
  let requestID = crypto.keccak256(
    concatByteArrays(call.from, ByteArray.fromUTF8(requestIndex.toString()))
  );
  let request = Request.load(requestID.toHexString());
  request.resolved = true;
  request.save();

  let challengeID = crypto.keccak256(
    concatByteArrays(requestID, ByteArray.fromUTF8("Challenge-0"))
  );
  let roundID = crypto.keccak256(
    concatByteArrays(challengeID, ByteArray.fromUTF8("0"))
  );
  updateContribution(
    call.to,
    call.from,
    requestIndex,
    new BigInt(0),
    new BigInt(0),
    roundID,
    call.from
  );
}

export function changeStateToPending(call: ChangeStateToPendingCall): void {
  let contract = Contract.load("0");
  let submission = Submission.load(call.inputs._submissionID.toHexString());
  submission.status = "PendingRegistration";
  submission.save();

  let request = Request.load(
    crypto
      .keccak256(
        concatByteArrays(
          call.inputs._submissionID,
          ByteArray.fromUTF8(
            submission.requestsLength.minus(new BigInt(1)).toString()
          )
        )
      )
      .toHexString()
  );
  request.lastStatusChange = call.block.timestamp;

  let vouches = call.inputs._vouches;
  for (let i = 0; i < vouches.length; i++) {
    let voucher = Submission.load(vouches[i].toHexString());
    if (
      !voucher.usedVouch &&
      voucher.registered &&
      call.block.timestamp
        .minus(voucher.submissionTime as BigInt)
        .le(contract.submissionDuration) &&
      voucher.vouchees.includes(submission.id)
    ) {
      request.vouches = request.vouches.concat([voucher.id]);
      voucher.usedVouch = submission.id;
      voucher.save();
    }
  }
  request.save();
}

export function challengeRequest(call: ChallengeRequestCall): void {
  let callInputsReason = getReason(call.inputs._reason);
  let proofOfHumanity = ProofOfHumanity.bind(call.to);
  let submission = Submission.load(call.inputs._submissionID.toHexString());

  let requestIndex = submission.requestsLength.minus(new BigInt(1));
  let requestID = crypto.keccak256(
    concatByteArrays(
      call.inputs._submissionID,
      ByteArray.fromUTF8(requestIndex.toString())
    )
  );
  let request = Request.load(requestID.toHexString());
  request.disputed = true;
  request.usedReasons = request.usedReasons.concat([callInputsReason]);
  request.currentReason = callInputsReason;
  request.nbParallelDisputes = request.nbParallelDisputes.plus(new BigInt(1));
  let evidenceIndex = request.evidenceLength;
  request.evidenceLength = evidenceIndex.plus(new BigInt(1));

  let evidence = new Evidence(
    crypto
      .keccak256(
        concatByteArrays(
          requestID,
          ByteArray.fromUTF8("Evidence-" + evidenceIndex.toString())
        )
      )
      .toHexString()
  );
  evidence.request = request.id;
  evidence.URI = call.inputs._evidence;
  evidence.sender = call.from;
  evidence.save();

  let challengeIndex = request.challengesLength.minus(new BigInt(1));
  let challengeID = crypto.keccak256(
    concatByteArrays(
      requestID,
      ByteArray.fromUTF8("Challenge-" + challengeIndex.toString())
    )
  );
  let challenge = Challenge.load(challengeID.toHexString());
  if (challenge.disputeID) {
    challengeIndex = request.challengesLength;
    request.challengesLength = request.challengesLength.plus(new BigInt(1));
    challengeID = concatByteArrays(
      requestID,
      ByteArray.fromUTF8("Challenge-" + challengeIndex.toString())
    );
    challenge = new Challenge(challengeID.toHexString());
  }
  request.save();

  let challengeInfo = proofOfHumanity.getChallengeInfo(
    call.inputs._submissionID,
    requestIndex,
    challengeIndex
  );
  challenge.request = request.id;
  challenge.disputeID = challengeInfo.value1;
  challenge.challenger = call.from;
  if (callInputsReason == "Duplicate") {
    challenge.duplicateSubmission = call.inputs._duplicateID.toHexString();
  }
  challenge.roundsLength = new BigInt(2);
  challenge.save();

  let round = new Round(
    crypto
      .keccak256(concatByteArrays(challengeID, ByteArray.fromUTF8("1")))
      .toHexString()
  );
  round.challenge = challenge.id;
  round.paidFees = [new BigInt(0), new BigInt(0)];
  round.hasPaid = [false, false];
  round.feeRewards = new BigInt(0);
  round.save();

  updateContribution(
    call.to,
    call.inputs._submissionID,
    requestIndex,
    challengeIndex,
    new BigInt(0),
    crypto.keccak256(concatByteArrays(challengeID, ByteArray.fromUTF8("0"))),
    call.from
  );
}

export function fundAppeal(call: FundAppealCall): void {
  let submission = Submission.load(call.inputs._submissionID.toHexString());
  let requestIndex = submission.requestsLength.minus(new BigInt(1));
  let requestID = crypto.keccak256(
    concatByteArrays(
      call.inputs._submissionID,
      ByteArray.fromUTF8(requestIndex.toString())
    )
  );
  let challengeID = crypto.keccak256(
    concatByteArrays(
      requestID,
      ByteArray.fromUTF8("Challenge-" + call.inputs._challengeID.toString())
    )
  );
  let challenge = Challenge.load(challengeID.toHexString());
  let roundIndex = challenge.roundsLength.minus(new BigInt(1));
  let roundID = crypto.keccak256(
    concatByteArrays(challengeID, ByteArray.fromUTF8(roundIndex.toString()))
  );

  updateContribution(
    call.to,
    call.inputs._submissionID,
    requestIndex,
    call.inputs._challengeID,
    roundIndex,
    roundID,
    call.from
  );

  let round = Round.load(roundID.toHexString());
  if (!round.hasPaid.includes(false)) {
    roundIndex = challenge.roundsLength;
    challenge.roundsLength = roundIndex.plus(new BigInt(1));
    challenge.save();
    round = new Round(
      crypto
        .keccak256(
          concatByteArrays(
            challengeID,
            ByteArray.fromUTF8(roundIndex.toString())
          )
        )
        .toHexString()
    );
    round.challenge = challenge.id;
    round.paidFees = [new BigInt(0), new BigInt(0)];
    round.hasPaid = [false, false];
    round.feeRewards = new BigInt(0);
    round.save();
  }
}

export function executeRequest(call: ExecuteRequestCall): void {
  let proofOfHumanity = ProofOfHumanity.bind(call.to);
  let submissionInfo = proofOfHumanity.getSubmissionInfo(
    call.inputs._submissionID
  );

  let submission = Submission.load(call.inputs._submissionID.toHexString());
  submission.status = "None";
  submission.registered = submissionInfo.value4;
  submission.submissionTime = submissionInfo.value1;
  submission.renewalTimestamp = submissionInfo.value2;
  submission.save();

  let requestIndex = submission.requestsLength.minus(new BigInt(1));
  let requestID = crypto.keccak256(
    concatByteArrays(
      call.inputs._submissionID,
      ByteArray.fromUTF8(requestIndex.toString())
    )
  );
  let request = Request.load(requestID.toHexString());
  request.resolved = true;
  request.save();

  let challengeID = crypto.keccak256(
    concatByteArrays(requestID, ByteArray.fromUTF8("Challenge-0"))
  );
  updateContribution(
    call.to,
    call.inputs._submissionID,
    requestIndex,
    new BigInt(0),
    new BigInt(0),
    crypto.keccak256(concatByteArrays(challengeID, ByteArray.fromUTF8("0"))),
    request.requester as Address
  );
}

export function processVouches(call: ProcessVouchesCall): void {
  let request = Request.load(
    crypto
      .keccak256(
        concatByteArrays(
          call.inputs._submissionID,
          ByteArray.fromUTF8(call.inputs._requestID.toString())
        )
      )
      .toHexString()
  );
  let requestVouchesLength = new BigInt(request.vouches.length);
  let actualIterations = call.inputs._iterations
    .plus(request.penaltyIndex)
    .gt(requestVouchesLength)
    ? requestVouchesLength.minus(request.penaltyIndex)
    : call.inputs._iterations;
  let endIndex = actualIterations.plus(request.penaltyIndex);
  request.penaltyIndex = endIndex;
  request.save();

  for (let i = 0; i < endIndex.toI32(); i++) {
    let vouches = request.vouches;
    let requestUsedReasons = request.usedReasons;

    let voucher = Submission.load(vouches[i]);
    voucher.usedVouch = null;

    if (request.ultimateChallenger != null) {
      if (
        requestUsedReasons[requestUsedReasons.length - 1] == "Duplicate" ||
        requestUsedReasons[requestUsedReasons.length - 1] == "DoesNotExist"
      ) {
        if (
          voucher.status == "Vouching" ||
          voucher.status == "PendingRegistration"
        ) {
          let voucherRequest = Request.load(
            crypto
              .keccak256(
                concatByteArrays(
                  ByteArray.fromHexString(voucher.id),
                  ByteArray.fromUTF8(
                    voucher.requestsLength.minus(new BigInt(1)).toString()
                  )
                )
              )
              .toHexString()
          );
          voucherRequest.requesterLost = true;
          voucherRequest.save();
        }

        voucher.registered = false;
      }
    }

    voucher.save();
  }
}

export function withdrawFeesAndRewards(call: WithdrawFeesAndRewardsCall): void {
  let requestID = crypto.keccak256(
    concatByteArrays(
      call.inputs._submissionID,
      ByteArray.fromUTF8(call.inputs._request.toString())
    )
  );
  let challengeID = crypto.keccak256(
    concatByteArrays(
      requestID,
      ByteArray.fromUTF8("Challenge-" + call.inputs._challengeID.toString())
    )
  );
  updateContribution(
    call.to,
    call.inputs._submissionID,
    call.inputs._request,
    call.inputs._challengeID,
    call.inputs._round,
    crypto.keccak256(
      concatByteArrays(
        challengeID,
        ByteArray.fromUTF8(call.inputs._round.toString())
      )
    ),
    call.inputs._beneficiary
  );
}

export function rule(call: RuleCall): void {
  let proofOfHumanity = ProofOfHumanity.bind(call.to);
  let challengeStruct = proofOfHumanity.arbitratorDisputeIDToChallenge(
    call.from,
    call.inputs._disputeID
  );
  let submissionInfo = proofOfHumanity.getSubmissionInfo(
    challengeStruct.value2
  );

  let submission = Submission.load(challengeStruct.value2.toHexString());
  submission.status = getStatus(submissionInfo.value0);
  submission.registered = submissionInfo.value4;
  submission.submissionTime = submissionInfo.value1;
  submission.renewalTimestamp = submissionInfo.value2;
  submission.save();

  let requestIndex = submission.requestsLength.minus(new BigInt(1));
  let requestInfo = proofOfHumanity.getRequestInfo(
    challengeStruct.value2,
    requestIndex
  );
  let requestID = crypto.keccak256(
    concatByteArrays(
      challengeStruct.value2,
      ByteArray.fromUTF8(requestIndex.toString())
    )
  );
  let request = Request.load(requestID.toHexString());
  request.disputed = requestInfo.value0;
  request.lastStatusChange = call.block.timestamp;
  request.resolved = requestInfo.value2;
  request.currentReason = getReason(requestInfo.value6);
  request.nbParallelDisputes = requestInfo.value7;
  request.ultimateChallenger = requestInfo.value4;
  request.requesterLost = requestInfo.value10;
  request.save();

  let challenge = Challenge.load(
    crypto
      .keccak256(
        concatByteArrays(
          requestID,
          ByteArray.fromUTF8("Challenge-" + challengeStruct.value0.toString())
        )
      )
      .toHexString()
  );
  challenge.ruling = proofOfHumanity.getChallengeInfo(
    challengeStruct.value2,
    requestIndex,
    challengeStruct.value0
  ).value2;
  challenge.save();
}
