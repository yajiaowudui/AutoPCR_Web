import { useSyncExternalStore } from 'react';

export type TaskStatus = 'running' | 'success' | 'warning' | 'error' | 'unknown';
export interface TaskProgress {
  id: string;
  account: string;
  title: string;
  status: TaskStatus;
  startedAt: number;
  finishedAt?: number;
  progress: string;
  summary: string;
}

let tasks: TaskProgress[] = [];
const listeners = new Set<() => void>();
function publish() { listeners.forEach(listener => listener()); }
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const snapshot = () => tasks;
export function useTaskProgress() { return useSyncExternalStore(subscribe, snapshot); }

export function startTask(account: string, title: string) {
  const id = `${account}-${Date.now()}-${Math.random()}`;
  // 保留最近 30 个已完成任务，正在执行的任务始终保留。
  const completed = tasks.filter(task => task.status !== 'running').slice(-29);
  tasks = [...tasks.filter(task => task.status === 'running'), ...completed, {
    id, account, title, status: 'running', startedAt: Date.now(),
    progress: '正在提交任务…', summary: '',
  }];
  publish();
  return id;
}

export function updateTask(id: string, changes: Partial<TaskProgress>) {
  tasks = tasks.map(task => task.id === id ? { ...task, ...changes } : task);
  publish();
}

export function clearFinishedTasks() {
  tasks = tasks.filter(task => task.status === 'running');
  publish();
}

export function resultStatus(result: { status?: string } | { daily_clean_time?: { status?: string } } | { status?: string }[]): TaskStatus {
  // 单项接口的后续行可能是历史结果，只按本次的首条结果判定。
  const statuses = Array.isArray(result) ? result.slice(0, 1).map(item => item.status)
    : ['daily_clean_time' in result ? result.daily_clean_time?.status : ('status' in result ? result.status : undefined)];
  if (statuses.some(status => status === '错误' || status === '致命')) return 'error';
  if (statuses.some(status => status === '警告' || status === '中止')) return 'warning';
  return 'success';
}
