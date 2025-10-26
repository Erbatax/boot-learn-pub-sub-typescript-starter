import { encode } from "@msgpack/msgpack"
import type { ConfirmChannel } from "amqplib"

export function publishJSON<T>(
  ch: ConfirmChannel,
  exchange: string,
  routingKey: string,
  value: T,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const bytes = Buffer.from(JSON.stringify(value))
    ch.publish(exchange, routingKey, bytes, { contentType: "application/json" }, (err) => {
      if (err) {
        reject(err)
      } else {
        resolve()
      }
    })
  })
}

export function publishMsgPack<T>(
  ch: ConfirmChannel,
  exchange: string,
  routingKey: string,
  value: T,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const encoded = encode(value)
    const bytes = Buffer.from(encoded.buffer, encoded.byteOffset, encoded.byteLength)
    ch.publish(exchange, routingKey, bytes, { contentType: "application/x-msgpack" }, (err) => {
      if (err) {
        reject(err)
      } else {
        resolve()
      }
    })
  })
} 