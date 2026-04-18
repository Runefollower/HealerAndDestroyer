import {
  applyPlayerMovementInput,
  integratePlayerMovement,
  PLAYER_MOVEMENT_INPUT_RATE_HZ,
  type PlayerMovementInput,
  type PlayerSnapshot,
  type SnapshotMessage
} from "@healer/shared";

const maxPredictionSeconds = 0.18;

// Builds a render-only snapshot that dead-reckons moving entities from the latest server state.
export function predictSnapshotForRender(
  snapshot: SnapshotMessage,
  snapshotReceivedAt: number | null,
  now: number,
  input: PlayerMovementInput
): SnapshotMessage {
  const elapsedSeconds = Math.min(maxPredictionSeconds, Math.max(0, (now - (snapshotReceivedAt ?? now)) / 1000));
  if (elapsedSeconds <= 0) {
    return snapshot;
  }

  return {
    ...snapshot,
    players: snapshot.players.map((player) =>
      player.playerId === snapshot.selfPlayerId
        ? predictSelfPlayer(player, elapsedSeconds, input)
        : predictRemotePlayer(player, elapsedSeconds)
    )
  };
}

// Predicts the local player with current client input so thrust starts moving immediately.
function predictSelfPlayer(player: PlayerSnapshot, elapsedSeconds: number, input: PlayerMovementInput): PlayerSnapshot {
  const predicted = clonePlayerForPrediction(player);
  const inputSamples = Math.max(1, Math.round(elapsedSeconds * PLAYER_MOVEMENT_INPUT_RATE_HZ));
  for (let sample = 0; sample < inputSamples; sample += 1) {
    applyPlayerMovementInput(predicted, input);
  }
  integratePlayerMovement(predicted, elapsedSeconds);
  return predicted;
}

// Predicts other players with simple dead reckoning from their authoritative velocity.
function predictRemotePlayer(player: PlayerSnapshot, elapsedSeconds: number): PlayerSnapshot {
  const predicted = clonePlayerForPrediction(player);
  integratePlayerMovement(predicted, elapsedSeconds);
  return predicted;
}

function clonePlayerForPrediction(player: PlayerSnapshot): PlayerSnapshot {
  return {
    ...player,
    position: { ...player.position },
    velocity: { ...player.velocity }
  };
}
