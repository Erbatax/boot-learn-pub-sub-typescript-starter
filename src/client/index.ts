import amqp from "amqplib"
import { clientWelcome, commandStatus, getInput, getMaliciousLog, printClientHelp, printQuit } from "../internal/gamelogic/gamelogic.js"
import { GameState } from "../internal/gamelogic/gamestate.js"
import type { GameLog } from "../internal/gamelogic/logs.js"
import { commandMove } from "../internal/gamelogic/move.js"
import { commandSpawn } from "../internal/gamelogic/spawn.js"
import { SimpleQueueType, subscribeJSON } from "../internal/pubsub/consume.js"
import { publishJSON, publishMsgPack } from "../internal/pubsub/publish.js"
import { ArmyMovesPrefix, ExchangePerilDirect, ExchangePerilTopic, GameLogSlug, PauseKey, WarRecognitionsPrefix } from "../internal/routing/routing.js"
import { handlerMove, handlerPause, handlerWar } from "./handlers.js"

async function main() {
  const rabbitConnString = "amqp://guest:guest@localhost:5672/"
  const connection = await amqp.connect(rabbitConnString)
  console.log("Peril game client connected to RabbitMQ!");

  ["SIGINT", "SIGTERM"].forEach((signal) =>
    process.on(signal, async () => {
      try {
        await connection.close()
        console.log("RabbitMQ connection closed.")
      } catch (err) {
        console.error("Error closing RabbitMQ connection:", err)
      } finally {
        process.exit(0)
      }
    }),
  )

  const username = await clientWelcome()
  const gameState = new GameState(username)
  const publishChannel = await connection.createConfirmChannel()

  // listen for pause/resume messages
  subscribeJSON(
    connection,
    ExchangePerilDirect,
    `${PauseKey}.${username}`,
    PauseKey,
    SimpleQueueType.Transient,
    handlerPause(gameState)
  )

  // listen for army move messages
  subscribeJSON(
    connection,
    ExchangePerilTopic,
    `${ArmyMovesPrefix}.${username}`,
    `${ArmyMovesPrefix}.*`,
    SimpleQueueType.Transient,
    handlerMove(gameState, publishChannel)
  )

  // listen for war recognition messages
  subscribeJSON(
    connection,
    ExchangePerilTopic,
    `${WarRecognitionsPrefix}`,
    `${WarRecognitionsPrefix}.*`,
    SimpleQueueType.Durable,
    handlerWar(gameState, publishChannel)
  )

  while (true) {
    const words = await getInput()
    if (words.length === 0) {
      continue
    }
    const command = words[0]!.toLowerCase()
    switch (command) {
      case "spawn":
        try {
          commandSpawn(gameState, words)
        } catch (err) {
          console.error((err as Error).message)
        }
        break
      case "move":
        try {
          const move = commandMove(gameState, words)
          // send move message
          publishJSON(
            publishChannel,
            ExchangePerilTopic,
            `${ArmyMovesPrefix}.${username}`,
            move
          )
        } catch (err) {
          console.error((err as Error).message)
        }
        break
      case "status":
        commandStatus(gameState)
        break
      case "help":
        printClientHelp()
        break
      case "spam":
        if (words.length < 2) {
          console.log("Usage: spam <count>")
          break
        }
        const count = parseInt(words[1]!)
        if (isNaN(count) || count <= 0) {
          console.log("Count must be a positive integer.")
          break
        }

        for (let i = 0; i < count; i++) {
          const logMessage = getMaliciousLog()
          publishGameLog(
            publishChannel,
            username,
            logMessage
          )
        }

        break
      case "quit":
        printQuit()
        process.exit(0)
      default:
        console.log(`Unknown command: ${command}. Type 'help' for a list of commands.`)
        break
    }
  }
}

export async function publishGameLog(ch: amqp.ConfirmChannel, username: string, message: string): Promise<void> {
  const gameLog: GameLog = {
    currentTime: new Date(),
    message: message,
    username: username,
  }

  await publishMsgPack(
    ch,
    ExchangePerilTopic,
    `${GameLogSlug}.${username}`,
    gameLog
  )
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
