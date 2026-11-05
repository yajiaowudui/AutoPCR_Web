import { Alert, Badge, Box, Button, Circle, Flex, Heading, Image, Input, NativeSelect, Stack, Text } from '@chakra-ui/react'
import { createFileRoute } from '@tanstack/react-router'
import { isAxiosError } from 'axios'
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { FiCornerUpLeft, FiSend, FiUser, FiX, FiZap } from 'react-icons/fi'
import { API, getErrorMessage } from '@api/APIUtils'
import { getUserInfo } from '@api/Account'
import { BATCH_RUNNER } from '@components/Account/accountShared'
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
    notices?: { id: number; timestamp: number; text: string }[]
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
    response?: { at: number; text: string; accounts?: AccountReply[]; batchImage?: string }
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

function AssistantPage() {
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
    const [aliases, setAliases] = useState<string[]>([])
    const [alias, setAlias] = useState('')
    const [accountError, setAccountError] = useState('')
    const inputRef = useRef<HTMLInputElement>(null)
    const timelineRef = useRef<HTMLDivElement>(null)
    const followLatest = useRef(true)
    const historyLoaded = useRef(false)
    const olderScroll = useRef<{ top: number; height: number } | null>(null)

    useEffect(() => {
        let active = true
        void getUserInfo().then(info => {
            if (!active) return
            const names = (info.accounts ?? []).map(account => account.name).filter(name => name !== BATCH_RUNNER)
            setAliases(names)
            const preferred = info.default_account ?? ''
            setAlias(names.includes(preferred) ? preferred : names.length === 1 ? names[0] : '')
        }).catch(() => {
            if (active) setAccountError('暂时无法加载游戏账号，可以在支持昵称的命令中手动填写。')
        })
        return () => { active = false }
    }, [])

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

    function fillCommand(text: string) {
        setQuote(undefined)
        setCommand(text)
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
        if (/^#?清除公会绑定数据\s+确认$/.test(input)
            && !window.confirm('清除所选账号在当前公会的考勤和助战缓存？')) return
        followLatest.current = true
        setSending(true)
        setCommandError('')
        try {
            await API.post('/arena/commands', {
                command: input, alias, quote: quote?.ref, quoteLabel: quote?.label,
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
        ...(feed?.notices ?? []).map(notice => ({
            key: `notice:${notice.id}`, at: notice.timestamp * 1000,
            own: false, sender: '竞技场提醒',
            content: <Text whiteSpace="pre-wrap">{notice.text}</Text>,
        })),
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
                key: `pending:${turn.id}`, at: turn.sentAt, own: false, sender: '聊天助手',
                content: <Text whiteSpace="pre-wrap" role="status">{turn.progress || '正在处理命令…'}</Text>,
            }]
            const { at, text, accounts, batchImage } = turn.response
            return [sent, {
                key: `reply:${turn.id}`, at, own: false, sender: '聊天助手',
                content: (
                    <Stack gap={2}>
                        {text && <Text whiteSpace="pre-wrap">{text}</Text>}
                        {batchImage && (
                            <Box as="details">
                                <Box as="summary" cursor="pointer">批量结果汇总</Box>
                                <Image src={batchImage} alt="批量结果汇总" maxW="full" loading="lazy" />
                            </Box>
                        )}
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
                <Flex gap={{ base: 2, md: 3 }} align="center" minW={0}>
                    <Circle size={{ base: 8, md: 10 }} flexShrink={0} bg="blue.solid" color="blue.contrast"><FiZap /></Circle>
                    <Box minW={0}>
                        <Heading size="md">聊天助手</Heading>
                        <Text fontSize="xs" color="fg.muted">竞技场、公会和清日常命令</Text>
                    </Box>
                </Flex>
                <Button variant="outline" size="sm" flexShrink={0} onClick={() => setRefresh(value => value + 1)}>刷新</Button>
            </Flex>
            {feed && (
                <Box as="details" fontSize="sm" px={2}>
                    <Box as="summary" cursor="pointer">竞技场订阅（{feed.subscriptions.length}）</Box>
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
                <Stack ref={timelineRef} role="log" aria-label="助手聊天记录" tabIndex={0}
                    bg="bg.subtle" gap={4} p={{ base: 3, md: 5 }}
                    height={{ base: 'clamp(15rem, 48dvh, 30rem)', md: 'clamp(19rem, 62dvh, 48rem)' }}
                    overflowY="auto" onScroll={event => {
                        const { scrollHeight, scrollTop, clientHeight } = event.currentTarget
                        followLatest.current = scrollHeight - scrollTop - clientHeight < 60
                    }}>
                    {messages.length === 0 && (
                        <Text textAlign="center" my="auto" color="fg.muted" fontSize="sm">
                            {!feed && !error ? '正在加载消息…' : '暂无消息。发送命令开始对话。'}
                        </Text>
                    )}
                    {messages.map(message => (
                        <ChatBubble key={message.key} own={message.own} sender={message.sender} at={message.at}>
                            {message.content}
                        </ChatBubble>
                    ))}
                </Stack>
                <Stack gap={2} p={3} borderTopWidth="1px" bg="bg">
                    <Flex wrap="wrap" gap={2} align="center">
                        <NativeSelect.Root size="sm" w={{ base: 'full', sm: 'auto' }} minW={{ sm: '9rem' }}
                            disabled={sending || !!quote}>
                            <NativeSelect.Field aria-label="游戏账号" value={alias} onChange={event => setAlias(event.target.value)}>
                                <option value="">默认账号</option>
                                {aliases.map(name => <option key={name} value={name}>{name}</option>)}
                            </NativeSelect.Field>
                            <NativeSelect.Indicator />
                        </NativeSelect.Root>
                        {['清日常', '日常记录', '公会考勤表', '我的助战', 'jjccx'].map(action => (
                            <Button key={action} size="xs" variant="outline" disabled={sending}
                                onClick={() => fillCommand(action)}>{action}</Button>
                        ))}
                    </Flex>
                    {accountError && <Text fontSize="xs" color="fg.muted">{accountError}</Text>}
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
                        <Input ref={inputRef} minW={0} aria-label="聊天助手命令" maxLength={300}
                            placeholder={quote ? '输入引用回复' : '输入命令，例如 清日常'}
                            value={command} disabled={sending} onChange={event => setCommand(event.target.value)} />
                        <Button type="submit" flexShrink={0} colorPalette="blue" loading={sending} disabled={!command.trim()}>
                            <FiSend /> 发送
                        </Button>
                    </Flex>
                    {commandError && <Text color="red.fg" fontSize="sm" role="alert">{commandError}</Text>}
                    <Box as="details" fontSize="xs" color="fg.muted">
                        <Box as="summary" cursor="pointer">命令帮助</Box>
                        <Stack gap={1} pt={2}>
                            <Text fontWeight="semibold">日常</Text>
                            <Text>「清日常」运行所选账号，也可以发「清日常 小号」「清日常 批量」或「清日常所有」。「日常记录」查看全部账号的记录，「日常报告 0」查看所选账号的最新报告。</Text>
                            <Text fontWeight="semibold" mt={2}>公会与支援</Text>
                            <Flex wrap="wrap" gap={1}>
                                {['上公会战支援', '上关卡支援', '上地下城支援'].map(action => (
                                    <Button key={action} size="xs" variant="ghost" disabled={sending}
                                        onClick={() => fillCommand(`${action} `)}>{action}</Button>
                                ))}
                            </Flex>
                            <Text>选好账号后发送「上公会战支援 角色名 5」「上关卡支援 角色名」「上地下城支援 角色名」。用「我的助战」查看位置，用「更换支援 3」撤下 3 号位。</Text>
                            <Text>公会命令包括「查公会成员 公会名」「更新公会数据」「公会考勤表」「公会深域查询」「精准助战 角色名」「公会BOX查询 角色名」「刷新BOX缓存 共享」「取消共享BOX」。「清除公会绑定数据 确认」只清理所选账号的考勤和助战缓存。</Text>
                            <Text>「查公会 公会名 [会长名]」查询会战排名，「查公会成员 公会名」查看成员和练度。同名公会可用「查公会成员 ID 数字」选择。</Text>
                            <Text>会战命令包括「Boss状态」「当前战报」「今日战报」「我的战报」「查询分段」「出刀监控」「取消出刀监控」「会战动态」「预约 3」「预约表」「申请出刀 3」「查树」「SL」「会战KPI」。</Text>
                            <Text fontWeight="semibold" mt={2}>竞技场</Text>
                            <Text>「jjccx [UID]」查询排名。「竞技场订阅状态」「竞技场提醒 1100 1」「竞技场换防 00000 1」管理订阅。渠道服和台服可加「渠」或「台」前缀，序号 0 表示该服的全部订阅。</Text>
                            <Text>「详细查询 1」按订阅序号查看排名、场次、公会、深域和支援，也可以直接填游戏 UID。</Text>
                            <Text>例如「#jjc记录 小号」「#pjjc透视 小号 flush」「#jjc回刺 小号 19 2」「#pjjc换防 小号」。昵称可换成「批量」或「所有」，省略时使用默认账号。</Text>
                            <Text>「#pjjc侦察 小号 22 0」优先使用阵容缓存，缓存不足时可能消耗挑战次数，默认侦察第 1 名。「#pjjc猜拳 小号 22」按排名调整进攻编队，0 表示随机错排，-1 表示最近一条对战记录。</Text>
                            <Text>回刺和 PJJC 猜拳开始执行时，会暂停对应账号的后台雷达和自动换防上号 10 分钟。</Text>
                            <Text>订阅管理：「竞技场绑定 UID 昵称」「删除竞技场绑定 1」「竞技场修改昵称 1 新昵称」「清空竞技场绑定」。从网页新建的订阅默认在网页显示通知。</Text>
                            <Text>上号保护：「#暂停上号 小号 60」「#恢复上号 批量」「#上号状态」。</Text>
                            <Text>雷达与监控：「刷榜 1」「p突发 1 1 5 10」「p突发重置 1」「雷达频率 5 1」「雷达缓存 10 1」「雷达策略重置 全部 1」「p被打换防状态」「p被打检测间隔 60 1」「竞技场活跃度 11 1」「竞技场活跃度状态」。</Text>
                            <Text>换防参数：「j掉名换防延时 30」「p掉名换防延时 15」「j雷达延时 30」「j补防次数 2」「j补防间隔 300」，末尾可加订阅序号。</Text>
                            <Text>工具：「#竞技场次数 小号」「#jjc预查 小号」「#jjc本地库」「#pjjc本地库」「#热门防守保护」。</Text>
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

export const Route = createFileRoute('/daily/_sidebar/arena/')({ component: AssistantPage })
