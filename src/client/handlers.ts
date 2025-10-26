import type { ConfirmChannel } from "amqplib"
import type { ArmyMove, RecognitionOfWar } from "../internal/gamelogic/gamedata.js"
import type { GameState, PlayingState } from "../internal/gamelogic/gamestate.js"
import { handleMove, MoveOutcome } from "../internal/gamelogic/move.js"
import { handlePause } from "../internal/gamelogic/pause.js"
import { handleWar, WarOutcome } from "../internal/gamelogic/war.js"
import { Acktype } from "../internal/pubsub/consume.js"
import { publishJSON } from "../internal/pubsub/publish.js"
import { ExchangePerilTopic, WarRecognitionsPrefix } from "../internal/routing/routing.js"
import { publishGameLog } from "./index.js"

export function handlerPause(gs: GameState): (ps: PlayingState) => Acktype {
    return (ps: PlayingState) => {
        handlePause(gs, ps)
        process.stdout.write("> ")
        return Acktype.Ack
    }
}

export function handlerMove(gs: GameState, ch: ConfirmChannel): (move: ArmyMove) => Promise<Acktype> {
    return async (move: ArmyMove) => {
        try {
            const outcome = handleMove(gs, move)
            switch (outcome) {
                case MoveOutcome.Safe:
                case MoveOutcome.SamePlayer:
                    return Acktype.Ack
                case MoveOutcome.MakeWar:
                    const recognition: RecognitionOfWar = {
                        attacker: move.player,
                        defender: gs.getPlayerSnap(),
                    }
                    try {
                        await publishJSON(
                            ch,
                            ExchangePerilTopic,
                            `${WarRecognitionsPrefix}.${gs.getUsername()}`,
                            recognition
                        )
                        return Acktype.Ack
                    } catch (err) {
                        console.error("Error publishing war recognition:", err)

                        return Acktype.NackRequeue
                    }
                default:
                    return Acktype.NackDiscard
            }
        }
        finally {
            process.stdout.write("> ")
        }
    }
}

export function handlerWar(gs: GameState, ch: ConfirmChannel): (war: RecognitionOfWar) => Acktype {
    return (rw: RecognitionOfWar) => {
        try {
            const outcome = handleWar(gs, rw)
            switch (outcome.result) {
                case WarOutcome.NotInvolved:
                    return Acktype.NackRequeue
                case WarOutcome.NoUnits:
                    return Acktype.NackDiscard
                case WarOutcome.YouWon:
                    try {
                        publishGameLog(
                            ch,
                            gs.getUsername(),
                            `${outcome.winner} won a war against ${outcome.loser}`
                        )
                    } catch (error) {
                        console.error("Error publishing game log:", error)
                        return Acktype.NackRequeue
                    }
                    return Acktype.Ack
                case WarOutcome.OpponentWon:
                    try {
                        publishGameLog(
                            ch,
                            gs.getUsername(),
                            `${outcome.winner} won a war against ${outcome.loser}`
                        )
                    } catch (error) {
                        console.error("Error publishing game log:", error)
                        return Acktype.NackRequeue
                    }
                    return Acktype.Ack
                case WarOutcome.Draw:
                    try {
                        publishGameLog(
                            ch,
                            gs.getUsername(),
                            `A war between ${outcome.attacker} and ${outcome.defender} resulted in a draw`
                        )
                    } catch (error) {
                        console.error("Error publishing game log:", error)
                        return Acktype.NackRequeue
                    }
                    return Acktype.Ack
                default:
                    const unreachable: never = outcome
                    console.log("Unexpected war resolution: ", unreachable)
                    return Acktype.NackDiscard
            }
        } finally {
            process.stdout.write("> ")
        }
    }
}