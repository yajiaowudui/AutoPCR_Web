import { Alert, Badge, Box, Button, Flex, Heading, Input, Stack, Text } from '@chakra-ui/react'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { API } from '@api/APIUtils'
import { BackgroundJobResponse, waitForBackgroundJob } from '@api/Account'
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

const platforms = ['B 服', '渠道服', '台服', '台服（其他）']

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
    const [progress, setProgress] = useState('')
    const [replies, setReplies] = useState<{ command: string; reply: string; results?: ResultInfo[] }[]>([])

    async function runCommand() {
        const input = command.trim()
        if (!input || sending) return
        setSending(true)
        const appendReply = (reply: string, results?: ResultInfo[]) => {
            setReplies(previous => [...previous, { command: input, reply, results }].slice(-20))
        }
        try {
            const { data } = await API.post<
                { reply: string } | { alias: string; job: BackgroundJobResponse<ResultInfo[]> }
            >('/arena/commands', { command: input })
            if (typeof data !== 'object' || data === null || (!('job' in data) && typeof data.reply !== 'string')) {
                appendReply('服务器未返回竞技场命令结果，请检查后端版本。')
                return
            }
            setCommand('')
            if ('job' in data) {
                try {
                    const results = await waitForBackgroundJob(data.alias, data.job.order, data.job, setProgress)
                    appendReply(results.length ? `${data.alias} · 任务已结束，展开查看结果。` : '任务已结束，未生成可查看的结果。', results.slice(0, 1))
                } catch (error) {
                    appendReply(error instanceof Error ? error.message : '无法读取任务结果，请先检查账号任务状态。')
                }
            } else {
                appendReply(data.reply)
            }
            setRefresh(value => value + 1)
        } finally {
            setSending(false)
            setProgress('')
        }
    }

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

    return (
        <Stack gap={5} width="full" maxW="3xl" mx="auto" py={3}>
            <Flex align="center" justify="space-between" gap={3}>
                <Box>
                    <Heading size="xl">竞技场消息</Heading>
                    <Text color="fg.muted" mt={1}>查看我的订阅和最近 50 条排名变化。</Text>
                </Box>
                <Button variant="outline" size="sm" onClick={() => setRefresh(value => value + 1)}>刷新</Button>
            </Flex>
            {error && (
                <Alert.Root status="error">
                    <Alert.Indicator />
                    <Alert.Title>{error}</Alert.Title>
                </Alert.Root>
            )}
            {!feed && !error && <Text color="fg.muted">正在加载竞技场消息…</Text>}
            {feed && (
                <>
                    <Box borderWidth="1px" rounded="lg" p={4}>
                        <Heading size="sm" mb={2}>我的订阅</Heading>
                        <Flex wrap="wrap" gap={2}>
                            {feed.subscriptions.map(sub => (
                                <Badge key={`${sub.platform}:${sub.uid}`} variant="subtle" whiteSpace="normal">
                                    {sub.name || sub.uid} · {platforms[sub.platform] ?? '其他服务器'}
                                    {' · '}提醒 {sub.notice} · 换防 {sub.defense}
                                </Badge>
                            ))}
                            {!feed.subscriptions.length && <Text color="fg.muted">暂无竞技场订阅。</Text>}
                        </Flex>
                    </Box>
                </>
            )}
                    <Box borderWidth="1px" rounded="lg" p={4}>
                        <Heading size="sm" mb={2}>Bot 命令</Heading>
                        <Text color="fg.muted" fontSize="sm" mb={3}>
                            用「jjccx」查询订阅账号的当前排名，也可在命令后填写 UID。
                            其他命令包括「竞技场订阅状态」「竞技场提醒 1100 1」「竞技场换防 00000 1」。
                            渠道服和台服分别加「渠」和「台」前缀。序号 0 表示该服的全部订阅。
                        </Text>
                        <Text color="fg.muted" fontSize="sm" mb={3}>
                            AutoPCR 支持 JJC／PJJC 的记录、透视、回刺和手动换防。
                            例如「#jjc记录 小号」「#pjjc透视 小号 flush」「#jjc回刺 小号 19 2」「#pjjc换防 小号」。
                            昵称省略时使用默认账号；回刺和手动换防会操作游戏。
                        </Text>
                        <Flex as="form" gap={2} onSubmit={event => {
                            event.preventDefault()
                            void runCommand().catch(() => undefined)
                        }}>
                            <Input aria-label="竞技场命令" placeholder="输入竞技场命令" maxLength={300}
                                value={command} disabled={sending} onChange={event => setCommand(event.target.value)} />
                            <Button type="submit" loading={sending} disabled={!command.trim()}>发送</Button>
                        </Flex>
                        {progress && <Text mt={2} whiteSpace="pre-wrap" fontSize="sm" role="status">{progress}</Text>}
                        <Stack mt={3} gap={3} aria-live="polite">
                            {replies.map((entry, index) => (
                                <Box key={index} bg="bg.subtle" rounded="md" p={3}>
                                    <Text fontWeight="medium" overflowWrap="anywhere">{entry.command}</Text>
                                    <Text mt={1} whiteSpace="pre-wrap" overflowWrap="anywhere">{entry.reply}</Text>
                                    {entry.results?.length ? <ResultList resultInfo={entry.results} /> : null}
                                </Box>
                            ))}
                        </Stack>
                    </Box>
            {feed && (
                <>
                    <Stack as="ul" gap={3} listStyleType="none">
                        {feed.events.map(event => (
                            <Box as="li" key={event.id} borderWidth="1px" rounded="lg" bg="bg.subtle" p={4}>
                                <Flex align="center" justify="space-between" gap={2} wrap="wrap">
                                    <Flex align="center" gap={2}>
                                        <Badge>{event.mode}</Badge>
                                        <Text fontWeight="medium">{event.name}</Text>
                                        <Text color="fg.muted" fontSize="sm">{platforms[event.platform]}</Text>
                                    </Flex>
                                    <Text color="fg.muted" fontSize="sm">
                                        {new Date(event.timestamp * 1000).toLocaleString('zh-CN')}
                                    </Text>
                                </Flex>
                                <Text mt={2}>
                                    排名 {event.before} → {event.after}
                                    {event.after < event.before ? '（上升）' : '（下降）'}
                                </Text>
                            </Box>
                        ))}
                    </Stack>
                    {!feed.events.length && <Text color="fg.muted">暂无排名变化记录。</Text>}
                </>
            )}
        </Stack>
    )
}

export const Route = createFileRoute('/daily/_sidebar/arena/')({ component: ArenaPage })
