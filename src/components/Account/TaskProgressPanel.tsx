import { Box, Button, Flex, HStack, Spinner, Text } from '@chakra-ui/react';
import { useEffect, useState } from 'react';
import { FiChevronDown, FiChevronUp, FiTrash2 } from 'react-icons/fi';
import { clearFinishedTasks, TaskProgress, useTaskProgress } from '@api/taskProgress';

const statusLabels = { running: '执行中', success: '完成', warning: '警告', error: '出错', unknown: '待确认' };
const statusColors = { running: 'blue', success: 'green', warning: 'orange', error: 'red', unknown: 'orange' };

function displayName(account: string) {
  try { return localStorage.getItem(`autopcr_displayName_${account}`) || account; }
  catch { return account; }
}

function TaskRow({ task, now }: { task: TaskProgress; now: number }) {
  const [expanded, setExpanded] = useState(false);
  const elapsed = Math.max(0, Math.floor(((task.finishedAt || now) - task.startedAt) / 1000));
  const duration = elapsed < 60 ? `${elapsed}秒` : `${Math.floor(elapsed / 60)}分${elapsed % 60}秒`;
  const lines = task.progress.split('\n').filter(Boolean);
  const current = task.status === 'running' ? lines[lines.length - 1] : task.summary;
  return (
    <Box borderTopWidth="1px" borderColor="border.subtle" py={2}>
      <Button variant="plain" width="full" height="auto" p={0} textAlign="left"
        aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
        <Box flex="1" minW={0}>
          <Flex justify="space-between" gap={2} align="center">
            <Text fontWeight="medium" truncate>{displayName(task.account)} · {task.title}</Text>
            <HStack gap={1} flexShrink={0} color={`${statusColors[task.status]}.fg`}>
              {task.status === 'running' && <Spinner size="xs" />}
              <Text fontSize="xs">{statusLabels[task.status]} · {duration}</Text>
            </HStack>
          </Flex>
          <Text fontSize="xs" color="fg.muted" fontWeight="normal" whiteSpace="normal" lineClamp={2} mt={1}>
            {current || '任务已提交，等待进度…'}
          </Text>
        </Box>
        {expanded ? <FiChevronUp /> : <FiChevronDown />}
      </Button>
      {expanded && <Box as="pre" data-testid="task-log" mt={2} p={2} bg="bg.muted" borderRadius="md"
        fontSize="xs" whiteSpace="pre-wrap" overflowWrap="anywhere" maxH="220px" overflowY="auto">
        {[task.summary, task.progress].filter(Boolean).join('\n\n')}
      </Box>}
    </Box>
  );
}

export default function TaskProgressPanel() {
  const tasks = useTaskProgress();
  const [open, setOpen] = useState(true);
  const [now, setNow] = useState(Date.now());
  const running = tasks.filter(task => task.status === 'running').length;
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  if (!tasks.length) return null;
  const counts = Object.entries(statusLabels).map(([status, label]) => {
    const count = tasks.filter(task => task.status === status).length;
    return count ? `${label} ${count}` : '';
  }).filter(Boolean).join(' · ');

  return (
    <Box role="region" aria-label="任务进度" position="fixed" bottom="3" right="3" zIndex={1300}
      width="380px" maxW="calc(100% - 24px)" bg="bg.panel" borderWidth="1px" borderColor="border.subtle"
      borderRadius="xl" shadow="lg" px={3} py={2}>
      <Flex align="center" gap={2}>
        <Button variant="plain" flex="1" p={0} height="auto" py={1} justifyContent="space-between"
          aria-expanded={open} aria-label="展开或收起任务进度" onClick={() => setOpen(value => !value)}>
          <Box textAlign="left">
            <Text fontWeight="semibold">任务进度</Text>
            <Text fontSize="xs" fontWeight="normal" color="fg.muted" mt={1}>{counts}</Text>
          </Box>
          {open ? <FiChevronDown /> : <FiChevronUp />}
        </Button>
        <Button size="xs" variant="ghost" disabled={running === tasks.length} aria-label="清除已结束任务"
          title="清除已结束任务" onClick={clearFinishedTasks}><FiTrash2 /></Button>
      </Flex>
      {open && <Box maxH="min(48vh, 420px)" overflowY="auto" mt={1}>
        {[...tasks].sort((a, b) => Number(b.status === 'running') - Number(a.status === 'running') || b.startedAt - a.startedAt)
          .map(task => <TaskRow key={task.id} task={task} now={now} />)}
        <Text fontSize="xs" color="fg.muted" pt={1}>点击任务展开日志；完整报告可在账号结果中查看。</Text>
      </Box>}
    </Box>
  );
}
