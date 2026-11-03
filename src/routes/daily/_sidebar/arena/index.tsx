import { Alert, Badge, Box, Button, Circle, Flex, Heading, Input, Stack, Text } from '@chakra-ui/react'
import { createFileRoute } from '@tanstack/react-router'
import { isAxiosError } from 'axios'
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { FiCornerUpLeft, FiSend, FiUser, FiX, FiZap } from 'react-icons/fi'
import { API, getErrorMessage } from '@api/APIUtils'
import { ResultInfo as ResultList } from '@components/Account/ResultInfo'
import { ResultInfo } from '@interfaces/UserInfo'

interface Subscription {
    platform: number
    uid: string
    name: string
    notice: string
    defense: string
}

interface ArenaEvent {
    id: number
    platform: number
    uid: string
    name: string
    timestamp: number
    mode: 'JJC' | 'PJJC'
    before: number
    after: number
}

interface ArenaFeed {
    subscriptions: Subscription[]
    events: ArenaEvent[]
}

type QuoteRef = { kind: 'rank'; platform: number; id: number }
    | { kind: 'result'; alias: string; order: string; key: string }

interface ChatQuote {
    ref: QuoteRef
    label: string
}

interface AccountReply {
    message: string
    results: ResultInfo[]
    details?: string
    quote?: ChatQuote
}

interface ChatTurn {
    id: number
    command: string
    sentAt: number
    quote?: Pick<ChatQuote, 'label'>
    progress?: string
    response?: { at: number; text: string; accounts?: AccountReply[] }
}

interface ChatHistory {
    turns: ChatTurn[]
    nextBefore: number | null
}

const platforms = ['B 服', '渠道服', '台服', '台服（其他）']
const chatTime = new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
})

function rankMessage(event: ArenaEvent) {
    return `${event.name || event.uid} · ${event.mode} · 第 ${event.before} 名 → 第 ${event.after} 名`
}

function isArenaFeed(data: unknown): data is ArenaFeed {
    if (typeof data !== 'object' || data === null) return false
    const feed = data as Partial<ArenaFeed>
    return Array.isArray(feed.subscriptions) && Array.isArray(feed.events)
}

function ArenaPage() {
    const [feed, setFeed] = useState<ArenaFeed>()
    const [error, setError] = useState('')
    const [refresh, setRefresh] = useState(0)
    const [command, setCommand] = useState('')
    const [sending, setSending] = useState(false)
    const [turns, setTurns] = useState<ChatTurn[]>([])
    const [before, setBefore] = useState<number | null>(null)
    const [loadingOlder, setLoadingOlder] = useState(false)
    const [historyError, setHistoryError] = useState('')
    const [commandError, setCommandError] = useState('')
    const [quote, setQuote] = useState<ChatQuote>()
    const inputRef = useRef<HTMLInputElement>(null)
    const timelineRef = useRef<HTMLDivElement>(null)
    const followLatest = useRef(true)
    const historyLoaded = useRef(false)
    const olderScroll = useRef<{ top: number; height: number } | null>(null)

    useLayoutEffect(() => {
        const timeline = timelineRef.current
        if (!timeline) return
        const older = olderScroll.current
        if (older) {
            timeline.scrollTop = older.top + timeline.scrollHeight - older.height
            olderScroll.current = null
        } else if (followLatest.current) {
            timeline.scrollTop = timeline.scrollHeight
        }
    }, [feed, turns])

    function selectQuote(selected: ChatQuote, action: string) {
        setQuote(selected)
        setCommand(action)
        inputRef.current?.focus()
    }

    const mergeHistory = useCallback((incoming: ChatTurn[]) => {
        setTurns(previous => {
            const byId = new Map(previous.map(turn => [turn.id, turn]))
            incoming.forEach(turn => {
                const existing = byId.get(turn.id)
                if (!existing?.response || turn.response) byId.set(turn.id, turn)
            })
            return Array.from(byId.values())
        })
    }, [])

    async function loadOlder() {
        if (before === null || loadingOlder) return
        setLoadingOlder(true)
        try {
            const { data } = await API.get<ChatHistory>('/arena/history', {
                params: { before }, skipErrorHandler: true,
            })
            if (!Array.isArray(data?.turns)) throw new Error('服务器未返回命令历史')
            if (timelineRef.current) {
                olderScroll.current = { top: timelineRef.current.scrollTop, height: timelineRef.current.scrollHeight }
            }
            mergeHistory(data.turns)
            setBefore(data.nextBefore)
        } catch {
            setHistoryError('暂时无法读取更早的命令，请重试。')
        } finally {
            setLoadingOlder(false)
        }
    }

    async function runCommand() {
        const input = command.trim()
        if (!input || sending) return
        followLatest.current = true
        setSending(true)
        setCommandError('')
        try {
            await API.post('/arena/commands', {
                command: input, quote: quote?.ref, quoteLabel: quote?.label,
            }, { skipErrorHandler: true })
            setCommand('')
            setQuote(undefined)
        } catch (error) {
            setCommandError(isAxiosError(error) ? getErrorMessage(error) : '命令未能完成，请检查账号任务状态。')
        } finally {
            setRefresh(value => value + 1)
            setSending(false)
        }
    }

    useEffect(() => {
        const controller = new AbortController()
        let loading = false
        async function load() {
            if (loading || document.hidden) return
            loading = true
            try {
                const { data } = await API.get<ChatHistory>('/arena/history', {
                    signal: controller.signal, skipErrorHandler: true,
                })
                if (controller.signal.aborted) return
                if (!Array.isArray(data?.turns)) throw new Error('服务器未返回命令历史')
                mergeHistory(data.turns)
                if (!historyLoaded.current) {
                    historyLoaded.current = true
                    setBefore(data.nextBefore)
                }
                setHistoryError('')
            } catch {
                if (!controller.signal.aborted) setHistoryError('暂时无法读取命令历史，请刷新重试。')
            } finally {
                loading = false
            }
        }
        void load()
        const timer = window.setInterval(load, 5000)
        document.addEventListener('visibilitychange', load)
        return () => {
            controller.abort()
            window.clearInterval(timer)
            document.removeEventListener('visibilitychange', load)
        }
    }, [refresh, mergeHistory])

    useEffect(() => {
        const controller = new AbortController()
        let pending = false
        async function load() {
            if (pending || document.hidden) return
            pending = true
            try {
                const { data } = await API.get<ArenaFeed>('/arena/feed', {
                    // Older backends returned a cacheable HTML page for this URL.
                    params: { _: Date.now() },
                    signal: controller.signal,
                    skipErrorHandler: true,
                })
                if (controller.signal.aborted) return
                if (!isArenaFeed(data)) {
                    setError('服务器未返回竞技场数据，请确认本地后端已更新到支持竞技场消息的版本。')
                    return
                }
                setFeed(data)
                setError('')
            } catch {
                if (!controller.signal.aborted) setError('暂时无法更新竞技场消息，请检查后端是否已启动，再点击刷新。')
            } finally {
                pending = false
            }
        }
        void load()
        const timer = window.setInterval(load, 30_000)
        document.addEventListener('visibilitychange', load)
        return () => {
            controller.abort()
            window.clearInterval(timer)
            document.removeEventListener('visibilitychange', load)
        }
    }, [refresh])

    const messages = [
        ...(feed?.events ?? []).map(event => {
            const selected: ChatQuote = {
                ref: { kind: 'rank', platform: event.platform, id: event.id },
                label: rankMessage(event),
            }
            return {
                key: `rank:${event.platform}:${event.id}`,
                at: event.timestamp * 1000,
                own: false,
                sender: '竞技场提醒',
                content: (
                    <Stack gap={2}>
                        <Flex gap={2} align="center" wrap="wrap">
                            <Badge colorPalette={event.mode === 'JJC' ? 'blue' : 'purple'}>{event.mode}</Badge>
                            <Text fontWeight="semibold">{event.name || event.uid}</Text>
                            <Text fontSize="xs" color="fg.muted">{platforms[event.platform] ?? '其他服务器'}</Text>
                        </Flex>
                        <Text>{event.after > event.before ? '掉排名' : '排名变化'} · 第 {event.before} 名 → 第 {event.after} 名</Text>
                        <Flex gap={1} wrap="wrap">
                            {(event.after > event.before ? ['回刺', '换防', '透视', '记录'] : ['记录']).map(action => (
                                <Button key={action} size="xs" variant={action === '回刺' ? 'subtle' : 'ghost'}
                                    colorPalette="blue" disabled={sending}
                                    onClick={() => selectQuote(selected, action)}>
                                    {action === '回刺' && <FiCornerUpLeft />}{action}
                                </Button>
                            ))}
                        </Flex>
                    </Stack>
                ),
            }
        }),
        ...turns.flatMap(turn => {
            const sent = {
                key: `sent:${turn.id}`, at: turn.sentAt, own: true, sender: '我',
                content: (
                    <Stack gap={1}>
                        {turn.quote && <QuotePreview label={turn.quote.label} />}
                        <Text whiteSpace="pre-wrap">{turn.command}</Text>
                    </Stack>
                ),
            }
            if (!turn.response) return [sent, {
                key: `pending:${turn.id}`, at: turn.sentAt, own: false, sender: '竞技场助手',
                content: <Text whiteSpace="pre-wrap" role="status">{turn.progress || '正在处理命令…'}</Text>,
            }]
            const { at, text, accounts } = turn.response
            return [sent, {
                key: `reply:${turn.id}`, at, own: false, sender: '竞技场助手',
                content: (
                    <Stack gap={2}>
                        {text && <Text whiteSpace="pre-wrap">{text}</Text>}
                        {accounts?.map((account, index) => (
                            <Box key={index}>
                                <Text>{account.message}</Text>
                                {account.details && (
                                    <Box as="details" mt={1} fontSize="sm">
                                        <Box as="summary" cursor="pointer">查看任务日志</Box>
                                        <Text mt={1} whiteSpace="pre-wrap">{account.details}</Text>
                                    </Box>
                                )}
                                {account.results.length > 0 && <ResultList resultInfo={account.results} />}
                                {account.quote && (
                                    <Button size="xs" variant="ghost" colorPalette="blue" disabled={sending}
                                        onClick={() => account.quote && selectQuote(account.quote, '换防')}>
                                        <FiCornerUpLeft /> 引用阵容换防
                                    </Button>
                                )}
                            </Box>
                        ))}
                    </Stack>
                ),
            }]
        }),
    ].sort((left, right) => left.at - right.at)

    return (
        <Stack gap={3} width="full" maxW="4xl" mx="auto" py={2}>
            <Flex align="center" justify="space-between" gap={3}>
                <Flex gap={3} align="center">
                    <Circle size={10} bg="blue.solid" color="blue.contrast"><FiZap /></Circle>
                    <Box>
                        <Heading size="md">竞技场消息</Heading>
                        <Text fontSize="xs" color="fg.muted">订阅提醒与竞技场命令</Text>
                    </Box>
                </Flex>
                <Button variant="outline" size="sm" onClick={() => setRefresh(value => value + 1)}>刷新</Button>
            </Flex>
            {feed && (
                <Box as="details" fontSize="sm" px={2}>
                    <Box as="summary" cursor="pointer">我的订阅（{feed.subscriptions.length}）</Box>
                    <Flex wrap="wrap" gap={2} py={2}>
                        {feed.subscriptions.map(sub => (
                            <Badge key={`${sub.platform}:${sub.uid}`} variant="subtle" whiteSpace="normal">
                                {sub.name || sub.uid} · {platforms[sub.platform] ?? '其他服务器'}
                                {' · '}提醒 {sub.notice} · 换防 {sub.defense}
                            </Badge>
                        ))}
                        {!feed.subscriptions.length && <Text color="fg.muted">暂无竞技场订阅。</Text>}
                    </Flex>
                </Box>
            )}
            {error && (
                <Alert.Root status="error">
                    <Alert.Indicator />
                    <Alert.Title>{error}</Alert.Title>
                </Alert.Root>
            )}
            <Stack gap={0} borderWidth="1px" rounded="xl" overflow="hidden">
                {historyError && <Text px={3} py={2} color="red.fg" fontSize="sm" role="alert">{historyError}</Text>}
                {before !== null && (
                    <Button size="xs" variant="ghost" alignSelf="center" my={1} loading={loadingOlder}
                        onClick={() => void loadOlder()}>加载更早的命令</Button>
                )}
                <Stack ref={timelineRef} role="log" aria-label="竞技场聊天记录" tabIndex={0}
                    bg="bg.subtle" gap={4} p={{ base: 3, md: 5 }} height="clamp(19rem, 62dvh, 48rem)"
                    overflowY="auto" onScroll={event => {
                        const { scrollHeight, scrollTop, clientHeight } = event.currentTarget
                        followLatest.current = scrollHeight - scrollTop - clientHeight < 60
                    }}>
                    {messages.length === 0 && (
                        <Text textAlign="center" my="auto" color="fg.muted" fontSize="sm">
                            {!feed && !error ? '正在加载竞技场消息…' : '暂无消息。发送命令开始对话。'}
                        </Text>
                    )}
                    {messages.map(message => (
                        <ChatBubble key={message.key} own={message.own} sender={message.sender} at={message.at}>
                            {message.content}
                        </ChatBubble>
                    ))}
                </Stack>
                <Stack gap={2} p={3} borderTopWidth="1px" bg="bg">
                    {quote && (
                        <Flex align="center" gap={2} bg="bg.subtle" rounded="md" p={2}>
                            <Box flex={1} minW={0}>
                                <QuotePreview label={quote.label} />
                                {quote.ref.kind === 'rank' && /^#?回刺(?:\s|$)/.test(command.trim()) && (
                                    <Text fontSize="xs" color="fg.muted" mt={1}>
                                        发送后会按这条通知的场次和掉名前排名回刺。可输入「回刺 2」指定第 2 套进攻阵容。
                                    </Text>
                                )}
                            </Box>
                            <Button aria-label="取消引用" size="xs" variant="ghost" disabled={sending}
                                onClick={() => { setQuote(undefined); inputRef.current?.focus() }}>
                                <FiX />
                            </Button>
                        </Flex>
                    )}
                    <Flex as="form" gap={2} onSubmit={event => {
                        event.preventDefault()
                        void runCommand()
                    }}>
                        <Input ref={inputRef} aria-label="竞技场命令" maxLength={300}
                            placeholder={quote ? '输入引用回复' : '输入竞技场命令，例如 #pjjc记录'}
                            value={command} disabled={sending} onChange={event => setCommand(event.target.value)} />
                        <Button type="submit" colorPalette="blue" loading={sending} disabled={!command.trim()}>
                            <FiSend /> 发送
                        </Button>
                    </Flex>
                    {commandError && <Text color="red.fg" fontSize="sm" role="alert">{commandError}</Text>}
                    <Box as="details" fontSize="xs" color="fg.muted">
                        <Box as="summary" cursor="pointer">命令帮助</Box>
                        <Stack gap={1} pt={2}>
                            <Text>「jjccx [UID]」查询排名。「竞技场订阅状态」「竞技场提醒 1100 1」「竞技场换防 00000 1」管理订阅。渠道服和台服可加「渠」或「台」前缀，序号 0 表示该服的全部订阅。</Text>
                            <Text>例如「#jjc记录 小号」「#pjjc透视 小号 flush」「#jjc回刺 小号 19 2」「#pjjc换防 小号」。昵称可换成「批量」或「所有」，省略时使用默认账号。</Text>
                            <Text>「#pjjc侦察 小号 22 0」优先使用阵容缓存，缓存不足时可能消耗挑战次数，默认侦察第 1 名。「#pjjc猜拳 小号 22」按排名调整进攻编队，0 表示随机错排，-1 表示最近一条对战记录。</Text>
                            <Text>回刺和 PJJC 猜拳开始执行时，会暂停对应账号的后台雷达和自动换防上号 10 分钟。</Text>
                        </Stack>
                    </Box>
                </Stack>
            </Stack>
        </Stack>
    )
}

function QuotePreview({ label }: { label: string }) {
    return (
        <Flex gap={2} align="center" borderStartWidth="3px" borderColor="blue.emphasized" ps={2}
            fontSize="xs" color="fg.muted" overflowWrap="anywhere">
            <FiCornerUpLeft aria-hidden /> <Text>{label}</Text>
        </Flex>
    )
}

function ChatBubble({ own = false, sender, at, children }: {
    own?: boolean
    sender: string
    at?: number
    children: ReactNode
}) {
    return (
        <Flex gap={2} direction={own ? 'row-reverse' : 'row'} align="start">
            <Circle size={8} flexShrink={0} bg={own ? 'blue.solid' : 'blue.subtle'}
                color={own ? 'blue.contrast' : 'blue.fg'} aria-hidden>
                {own ? <FiUser /> : <FiZap />}
            </Circle>
            <Stack gap={1} align={own ? 'end' : 'start'} minW={0} maxW={{ base: '89%', md: '82%' }}>
                <Text fontSize="xs" color="fg.muted">
                    {sender}{at !== undefined && ` · ${chatTime.format(at)}`}
                </Text>
                <Box maxW="full" px={3} py={2} rounded="xl" bg={own ? 'blue.subtle' : 'bg.panel'}
                    borderWidth="1px" borderColor={own ? 'blue.muted' : 'border.subtle'} overflowWrap="anywhere">
                    {children}
                </Box>
            </Stack>
        </Flex>
    )
}

export const Route = createFileRoute('/daily/_sidebar/arena/')({ component: ArenaPage })
