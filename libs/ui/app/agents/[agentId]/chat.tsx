"use client"

import * as React from "react"
import { fetchEventSource } from "@microsoft/fetch-event-source"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"
import { motion } from "framer-motion"
import { RxChatBubble, RxCode } from "react-icons/rx"
import { useAsyncFn } from "react-use"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"

import { Agent } from "@/types/agent"
import { Profile } from "@/types/profile"
import { Api } from "@/lib/api"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Toaster } from "@/components/ui/toaster"
import { useToast } from "@/components/ui/use-toast"
import { CodeBlock } from "@/components/codeblock"
import { MemoizedReactMarkdown } from "@/components/markdown"

import PromptForm from "./prompt-form"

dayjs.extend(relativeTime)

function PulsatingCursor() {
  return (
    <motion.div
      initial="start"
      animate={{
        scale: [1, 1, 1],
        opacity: [0, 1, 0],
      }}
      transition={{
        duration: 0.5,
        repeat: Infinity,
      }}
    >
      ▍
    </motion.div>
  )
}

export function Message({
  type,
  message,
  profile,
}: {
  type: string
  message: string
  profile: Profile
}) {
  return (
    <div className="min-w-4xl flex max-w-4xl space-x-4 border-b pb-2">
      <Avatar className="h-8 w-8">
        <AvatarImage src={type === "ai" ? "/logo.png" : undefined} />
        <AvatarFallback>
          {type === "human" &&
            `${profile.first_name.charAt(0)}${profile.last_name.charAt(0)}`}
        </AvatarFallback>
      </Avatar>
      <div className="ml-4 mt-1 flex-1 space-y-2 overflow-hidden px-1">
        {message?.length === 0 && <PulsatingCursor />}
        <MemoizedReactMarkdown
          className="prose dark:prose-invert prose-p:leading-relaxed prose-pre:p-0 break-words text-sm"
          remarkPlugins={[remarkGfm, remarkMath]}
          components={{
            p({ children }) {
              return <p className="mb-5">{children}</p>
            },
            a({ children, href }) {
              return (
                <a
                  href={href}
                  className="text-primary underline"
                  rel="noreferrer"
                  target="_blank"
                >
                  {children}
                </a>
              )
            },
            ol({ children }) {
              return <ol className="mb-5 list-decimal pl-[30px]">{children}</ol>
            },
            ul({ children }) {
              return <ul className="mb-5 list-disc pl-[30px]">{children}</ul>
            },
            li({ children }) {
              return <li className="pb-1">{children}</li>
            },
            code({ node, inline, className, children, ...props }) {
              if (children.length) {
                if (children[0] == "▍") {
                  return (
                    <span className="mt-1 animate-pulse cursor-default">▍</span>
                  )
                }

                children[0] = (children[0] as string).replace("`▍`", "▍")
              }

              const match = /language-(\w+)/.exec(className || "")

              if (inline) {
                return (
                  <code
                    className="light:bg-slate-200 px-1 text-sm dark:bg-slate-800"
                    {...props}
                  >
                    {children}
                  </code>
                )
              }

              return (
                <CodeBlock
                  key={Math.random()}
                  language={(match && match[1]) || ""}
                  value={String(children).replace(/\n$/, "")}
                  {...props}
                />
              )
            },
          }}
        >
          {message}
        </MemoizedReactMarkdown>
      </div>
    </div>
  )
}

export default function Chat({
  agent,
  profile,
}: {
  agent: Agent
  profile: Profile
}) {
  const api = new Api(profile.api_key)
  const [selectedView, setSelectedView] = React.useState<"chat" | "trace">(
    "chat"
  )
  const [messages, setMessages] = React.useState<
    { type: string; message: string }[]
  >([])
  const [timer, setTimer] = React.useState<number>(0)
  const [session, setSession] = React.useState<string | null>(null)
  const timerRef = React.useRef<NodeJS.Timeout | null>(null)
  const { toast } = useToast()

  const [{ loading: isLoadingRuns, value: runs = [] }, getAgentRuns] =
    useAsyncFn(async () => {
      const { data: runs } = await api.getAgentRuns(agent.id)
      return runs
    }, [agent])

  async function onSubmit(value: string) {
    let message = ""

    setTimer(0)
    timerRef.current = setInterval(() => {
      setTimer((prevTimer) => prevTimer + 0.1)
    }, 100)

    setMessages((previousMessages: any) => [
      ...previousMessages,
      { type: "human", message: value },
    ])

    setMessages((previousMessages) => [
      ...previousMessages,
      { type: "ai", message },
    ])

    await fetchEventSource(
      `${process.env.NEXT_PUBLIC_SUPERAGENT_API_URL}/agents/${agent.id}/invoke`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authorization: `Bearer ${profile.api_key}`,
        },
        body: JSON.stringify({
          input: value,
          enableStreaming: true,
          sessionId: session,
        }),
        openWhenHidden: true,
        async onclose() {
          setTimer(0)
          if (timerRef.current) {
            clearInterval(timerRef.current)
          }
        },
        async onmessage(event) {
          if (event.data !== "[END]") {
            message += event.data === "" ? `${event.data} \n` : event.data
            setMessages((previousMessages) => {
              let updatedMessages = [...previousMessages]

              for (let i = updatedMessages.length - 1; i >= 0; i--) {
                if (updatedMessages[i].type === "ai") {
                  updatedMessages[i].message = message
                  break
                }
              }

              return updatedMessages
            })
          }
        },
      }
    )
  }

  const calculateRunDuration = (start_date: string, end_date: string) => {
    const startDate = new Date(start_date?.replace(" ", "T"))
    const endDate = new Date(end_date?.replace(" ", "T"))
    const seconds = (endDate.getTime() - startDate.getTime()) / 1000
    return seconds.toFixed(1)
  }

  React.useEffect(() => {
    selectedView === "trace" && getAgentRuns()
  }, [selectedView, getAgentRuns])

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden border-r">
      <div className="absolute inset-x-0 top-0 z-50 flex items-center justify-between p-4">
        <p
          className={`${
            timer === 0 ? "text-muted-foreground" : "text-primary"
          } font-mono text-sm`}
        >
          {timer.toFixed(1)}s
        </p>
        <div className="self-end">
          <Select
            value={selectedView}
            onValueChange={(value) =>
              setSelectedView(value as "chat" | "trace")
            }
          >
            <SelectTrigger className="w-[90px]">
              <SelectValue placeholder="Chat" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="chat">Chat</SelectItem>
              <SelectItem value="trace">Trace</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <ScrollArea className="relative flex grow flex-col px-4">
        <div className="from-background absolute inset-x-0 top-0 z-20 h-20 bg-gradient-to-b from-0% to-transparent to-50%" />
        {selectedView === "chat" ? (
          <div className="mb-20 mt-10 flex flex-col space-y-5 py-5">
            <div className="container mx-auto flex max-w-4xl flex-col space-y-5">
              {messages.map(({ type, message }) => (
                <Message type={type} message={message} profile={profile} />
              ))}
            </div>
          </div>
        ) : (
          <div className="container my-10 flex max-w-2xl flex-col space-y-4">
            {runs
              .filter((run: any) => run.child_run_ids)
              .map((run: any) => (
                <Card key={run.id}>
                  <CardHeader>
                    <div className="flex justify-between space-x-4">
                      <p className="flex-1">{run.inputs.input}</p>
                      <div className="flex items-center space-x-4">
                        <p className="text-primary font-mono text-xs">
                          {run.total_tokens} tokens
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {dayjs(run.start_time).fromNow()}
                        </p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="relative flex max-h-40 grow flex-col rounded-lg border p-3">
                      <Message
                        type="ai"
                        message={run.outputs?.output}
                        profile={profile}
                      />
                    </ScrollArea>
                    <div className="mt-2 flex flex-col space-y-2">
                      {run.child_run_ids.map((run_id: string) => {
                        const activeRun = runs.find(
                          (run: any) => run.id === run_id
                        )

                        return (
                          <div
                            key={activeRun.id}
                            className="flex items-center space-x-4"
                          >
                            <div className="flex h-8 w-8 flex-col items-center justify-center rounded-lg border">
                              {activeRun.run_type === "tool" ? (
                                <RxCode />
                              ) : (
                                <RxChatBubble />
                              )}
                            </div>
                            <Badge variant="outline">{activeRun.name}</Badge>

                            <p className="text-muted-foreground font-mono text-xs">
                              {calculateRunDuration(
                                activeRun.start_time,
                                activeRun.end_time
                              )}
                              s
                            </p>
                            <p className="text-muted-foreground font-mono text-xs">
                              {activeRun.total_tokens} tokens
                            </p>
                          </div>
                        )
                      })}
                    </div>
                  </CardContent>
                </Card>
              ))}
          </div>
        )}
      </ScrollArea>
      {selectedView === "chat" && (
        <div className="from-background absolute inset-x-0 bottom-0 z-50 h-20 bg-gradient-to-t from-50% to-transparent to-100%">
          <div className="relative mx-auto mb-6 max-w-2xl px-8">
            <PromptForm
              onSubmit={async (value) => {
                onSubmit(value)
              }}
              onCreateSession={async (uuid) => {
                setSession(uuid)
                setMessages([])
                toast({
                  description: "New session created",
                })
              }}
              isLoading={false}
            />
          </div>
        </div>
      )}
      <Toaster />
    </div>
  )
}
