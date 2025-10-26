import amqp from "amqplib"
import { getInput, printServerHelp } from "../internal/gamelogic/gamelogic.js"
import type { PlayingState } from "../internal/gamelogic/gamestate.js"
import { writeLog, type GameLog } from "../internal/gamelogic/logs.js"
import { Acktype, SimpleQueueType, subscribeMsgPack } from "../internal/pubsub/consume.js"
import { publishJSON } from "../internal/pubsub/publish.js"
import { ExchangePerilDirect, ExchangePerilTopic, GameLogSlug, PauseKey } from "../internal/routing/routing.js"

async function main() {
  const rabbitConnString = "amqp://guest:guest@localhost:5672/"
  const connection = await amqp.connect(rabbitConnString)
  console.log("Peril game server connected to RabbitMQ!");

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

  const publishChannel = await connection.createConfirmChannel()

  // create game log queue
  await subscribeMsgPack(connection,
    ExchangePerilTopic,
    GameLogSlug,
    `${GameLogSlug}.*`,
    SimpleQueueType.Durable,
    async (log: GameLog) => {
      await writeLog(log)
      console.log(log)
      return Acktype.Ack
    }
  )

  // Used to run the server from a non-interactive source, like the multiserver.sh file
  if (!process.stdin.isTTY) {
    console.log("Non-interactive mode: skipping command input.")
    return
  }

  printServerHelp()

  while (true) {
    const words = await getInput()
    if (words.length === 0) {
      continue
    }

    const command = words[0]!.toLowerCase()
    switch (command) {
      case "help":
        printServerHelp()
        break
      case "pause":
        console.log("Publishing paused game state")
        try {
          publishJSON(
            publishChannel,
            ExchangePerilDirect,
            PauseKey,
            { isPaused: true } as PlayingState
          )
        } catch (err) {
          console.error("Error publishing pause message:", err)
        }
        break
      case "resume":
        console.log("Publishing resumed game state")
        try {
          publishJSON(
            publishChannel,
            ExchangePerilDirect,
            PauseKey,
            { isPaused: false } as PlayingState
          )
        } catch (err) {
          console.error("Error publishing resume message:", err)
        }
        break
      case "quit":
        console.log("Goodbye!")
        process.exit(0)
      default:
        console.log(`Unknown command: ${command}. Type 'help' for a list of commands.`)
        break
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
