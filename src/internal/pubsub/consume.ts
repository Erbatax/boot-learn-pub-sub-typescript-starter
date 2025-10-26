import { decode } from "@msgpack/msgpack"
import amqp, { type Channel } from "amqplib"
import { ExchangePerilDLX } from "../routing/routing.js"

export enum Acktype {
    Ack,
    NackRequeue,
    NackDiscard,
}

export enum SimpleQueueType {
    Durable,
    Transient,
}

export async function declareAndBind(
    conn: amqp.ChannelModel,
    exchange: string,
    queueName: string,
    key: string,
    queueType: SimpleQueueType,
): Promise<[Channel, amqp.Replies.AssertQueue]> {
    const channel = await conn.createChannel()
    const assertQueue = await channel.assertQueue(queueName, {
        durable: queueType === SimpleQueueType.Durable,
        autoDelete: queueType === SimpleQueueType.Transient,
        exclusive: queueType === SimpleQueueType.Transient,
        arguments:
            { "x-dead-letter-exchange": ExchangePerilDLX },

    })

    await channel.bindQueue(assertQueue.queue, exchange, key)
    return [channel, assertQueue]
}

export async function subscribeJSON<T>(
    conn: amqp.ChannelModel,
    exchange: string,
    queueName: string,
    key: string,
    queueType: SimpleQueueType,
    handler: (data: T) => Promise<Acktype> | Acktype,
): Promise<void> {
    await subscribe<T>(
        conn,
        exchange,
        queueName,
        key,
        queueType,
        handler,
        "application/json",
        (data: Buffer) => {
            const jsonString = data.toString("utf-8")
            return JSON.parse(jsonString) as T
        }
    )
}

export async function subscribeMsgPack<T>(
    conn: amqp.ChannelModel,
    exchange: string,
    queueName: string,
    key: string,
    queueType: SimpleQueueType,
    handler: (data: T) => Promise<Acktype> | Acktype,
): Promise<void> {
    await subscribe<T>(
        conn,
        exchange,
        queueName,
        key,
        queueType,
        handler,
        "application/x-msgpack",
        (data: Buffer) => {
            const decoded = decode(data)
            return decoded as T
        }
    )
}

export async function subscribe<T>(
    conn: amqp.ChannelModel,
    exchange: string,
    queueName: string,
    routingKey: string,
    simpleQueueType: SimpleQueueType,
    handler: (data: T) => Promise<Acktype> | Acktype,
    acceptedContentType: string,
    unmarshaller: (data: Buffer) => T,
): Promise<void> {
    const [channel, assertQueue] = await declareAndBind(conn, exchange, queueName, routingKey, simpleQueueType)
    await channel.prefetch(10)

    channel.consume(assertQueue.queue, async (msg) => {
        if (msg) {
            if (msg.properties.contentType === acceptedContentType) {
                try {
                    const data: T = unmarshaller(msg.content)
                    const ackResponse = await handler(data)

                    switch (ackResponse) {
                        case Acktype.Ack:
                            channel.ack(msg)
                            break
                        case Acktype.NackRequeue:
                            channel.nack(msg, false, true)
                            break
                        case Acktype.NackDiscard:
                            channel.nack(msg, false, false)
                            break
                    }
                } catch (err) {
                    console.error("Failed to parse message:", err)
                }
            } else {
                console.warn(`Received message with unexpected content type: ${msg.properties.contentType}`)
            }
        }
    })
}