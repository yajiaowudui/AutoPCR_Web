import { ModuleResult } from '@interfaces/ModuleResult';
import { API, getErrorMessage } from '@api/APIUtils';
import { isAxiosError } from 'axios';
import { startTask, updateTask, resultStatus } from './taskProgress';
import { AccountResponse, ValidateResponse, RunningStatusResponse } from '@interfaces/Account';
import { DefaultResponse } from '@interfaces/DefaultResponse';
import { ConfigValue, ModuleResponse } from '@interfaces/Module';
import {AccountInfo, ResultInfo, RoleInfo, UserInfo, UserInfoResponse} from '@interfaces/UserInfo';
import {useEffect, useState} from "react";

const ACCOUNT_CONFIG_CACHE_LIMIT = 24;
const accountConfigCache = new Map<string, ModuleResponse>();
const accountConfigRequests = new Map<string, Promise<ModuleResponse>>();
let accountConfigCacheVersion = 0;

interface BackgroundJobResponse<T> {
  job_id: string;
  status: "running" | "completed" | "failed";
  order: string;
  progress: string;
  result: T | null;
  error: string;
  summary?: string;
}

async function getActiveBackgroundJob<T>(alias: string) {
  const response = await API.get<BackgroundJobResponse<T> | null>(
    `/account/${encodeURIComponent(alias)}/active_background_job`,
    { validateStatus: status => status === 200 || status === 204, skipErrorHandler: true },
  );
  return response.status === 200 ? response.data : null;
}

async function waitForBackgroundJob<T>(
  alias: string,
  expectedOrder: string,
  job: BackgroundJobResponse<T>,
  onProgress?: (progress: string) => void,
) {
  if (job.order !== expectedOrder) {
    throw new Error(`该账号正在执行${job.order === "daily" ? "清日常" : job.order}，请等待完成`);
  }

  let currentJob = job;
  let lastProgress = "";
  let failures = 0;
  while (currentJob.status === "running") {
    if (currentJob.progress && currentJob.progress !== lastProgress) {
      lastProgress = currentJob.progress;
      onProgress?.(currentJob.progress);
    }
    await new Promise(resolve => window.setTimeout(resolve, 5000));
    try {
      const statusResponse = await API.get<BackgroundJobResponse<T>>(
        `/account/${encodeURIComponent(alias)}/background_job/${currentJob.job_id}`,
        { timeout: 30 * 1000, skipErrorHandler: true },
      );
      currentJob = statusResponse.data;
      if (failures > 0) lastProgress = '';
      failures = 0;
    } catch (error) {
      const transient = isAxiosError(error) && (!error.response || error.response.status >= 500);
      if (isAxiosError(error) && error.response?.status === 404) {
        throw new TaskStatusUnknown('任务记录已失效，服务器可能已重启。请查看账号最新结果后再决定是否重新执行。');
      }
      if (!transient) throw error;
      failures += 1;
      onProgress?.(`暂时无法获取进度，正在重新连接（${failures}/3）；后台任务仍可能在执行，请勿重复提交。`);
      if (failures >= 3) {
        throw new TaskStatusUnknown('暂时无法确认执行结果。任务可能仍在后台运行，网络恢复后点击原任务按钮可继续查看进度。');
      }
    }
  }

  if (currentJob.progress || currentJob.summary) {
    onProgress?.([currentJob.summary, currentJob.progress].filter(Boolean).join('\n'));
  }
  if (currentJob.status === "failed") {
    rememberJob(alias, expectedOrder);
    throw new Error(currentJob.error || "后台任务执行失败");
  }
  if (currentJob.result === null) {
    throw new Error("后台任务已完成，但没有返回结果");
  }
  return currentJob.result;
}

class TaskStatusUnknown extends Error {}

const pendingJobKey = (alias: string, order: string) => `autopcr_pending_job_${alias}_${order}`;
function rememberJob(alias: string, order: string, jobId?: string) {
  try {
    if (jobId) sessionStorage.setItem(pendingJobKey(alias, order), jobId);
    else sessionStorage.removeItem(pendingJobKey(alias, order));
  } catch { /* 存储不可用时仍可在当前页面跟踪任务 */ }
}

async function getPendingJob<T>(alias: string, order: string) {
  let jobId: string | null = null;
  try { jobId = sessionStorage.getItem(pendingJobKey(alias, order)); } catch { /* 忽略 */ }
  if (!jobId) return null;
  try {
    const response = await API.get<BackgroundJobResponse<T>>(
      `/account/${encodeURIComponent(alias)}/background_job/${encodeURIComponent(jobId)}`, { skipErrorHandler: true });
    return response.data;
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 404) rememberJob(alias, order);
    throw new TaskStatusUnknown('暂时无法恢复上次任务的结果，请先查看账号最新结果后再决定是否重新执行。');
  }
}

async function runAccountTask<T extends AccountInfo | ResultInfo[]>(
  alias: string, order: string, title: string,
  submit: () => Promise<{ status: number; data: T | BackgroundJobResponse<T> }>,
  onProgress?: (progress: string) => void,
) {
  const id = startTask(alias, title);
  const progress = (message: string) => {
    updateTask(id, { progress: message });
    onProgress?.(message);
  };
  try {
    let activeJob = await getPendingJob<T>(alias, order) || await getActiveBackgroundJob<T>(alias);
    let result: T;
    if (activeJob) {
      if (activeJob.order === order) rememberJob(alias, order, activeJob.job_id);
      result = await waitForBackgroundJob(alias, order, activeJob, progress);
    } else {
      let response;
      try {
        response = await submit();
      } catch (error) {
        // 提交响应丢失时只查询已受理任务，不重新发送执行请求。
        if (!isAxiosError(error) || (error.response && error.response.status < 500)) throw error;
        try { activeJob = await getActiveBackgroundJob<T>(alias); } catch { /* 保留状态未确认 */ }
        if (!activeJob) throw new TaskStatusUnknown('提交响应中断，暂时无法确认是否已受理。请先查看账号运行状态和最新结果，避免重复执行。');
      }
      if (!activeJob && response!.status === 202) activeJob = response!.data as BackgroundJobResponse<T>;
      if (activeJob) {
        if (activeJob.order === order) rememberJob(alias, order, activeJob.job_id);
        result = await waitForBackgroundJob(alias, order, activeJob, progress);
      } else result = response!.data as T;
    }
    rememberJob(alias, order);
    const status = resultStatus(result);
    updateTask(id, {
      status, finishedAt: Date.now(),
      summary: status === 'error' ? '任务结束，部分步骤出错，展开查看原因'
        : status === 'warning' ? '任务结束，含警告或中止，展开查看说明' : '执行完成',
    });
    return result;
  } catch (error) {
    const unknown = error instanceof TaskStatusUnknown;
    updateTask(id, {
      status: unknown ? 'unknown' : 'error', finishedAt: Date.now(),
      summary: isAxiosError(error) ? getErrorMessage(error) : error instanceof Error ? error.message : '任务执行失败',
    });
    throw error;
  }
}

const accountConfigCacheKey = (alias: string, area: string) => `${alias}\u0000${area}`;

function cacheAccountConfig(key: string, config: ModuleResponse) {
  // Reinsert hits at the end so the map also acts as a small LRU cache.
  accountConfigCache.delete(key);
  accountConfigCache.set(key, config);

  while (accountConfigCache.size > ACCOUNT_CONFIG_CACHE_LIMIT) {
    const oldestKey = accountConfigCache.keys().next().value;
    if (oldestKey === undefined) break;
    accountConfigCache.delete(oldestKey);
  }
}

function updateCachedAccountConfigs(alias: string, configs: Record<string, ConfigValue>) {
  const keyPrefix = `${alias}\u0000`;
  const updates: [string, ModuleResponse][] = [];

  for (const [key, cached] of accountConfigCache) {
    if (!key.startsWith(keyPrefix)) continue;

    const relevantEntries = Object.entries(configs).filter(([configKey]) =>
      Object.prototype.hasOwnProperty.call(cached.config, configKey),
    );
    if (relevantEntries.length === 0) continue;

    updates.push([key, {
      ...cached,
      config: { ...cached.config, ...Object.fromEntries(relevantEntries) },
    }]);
  }

  for (const [key, updated] of updates) {
    cacheAccountConfig(key, updated);
  }
}

function clearCachedAccountConfigs(alias?: string) {
  // Prevent requests started before an import/sync/delete from repopulating stale data.
  accountConfigCacheVersion += 1;

  if (alias === undefined) {
    accountConfigCache.clear();
    accountConfigRequests.clear();
    return;
  }

  const keyPrefix = `${alias}\u0000`;
  for (const key of accountConfigCache.keys()) {
    if (key.startsWith(keyPrefix)) accountConfigCache.delete(key);
  }
  for (const key of accountConfigRequests.keys()) {
    if (key.startsWith(keyPrefix)) accountConfigRequests.delete(key);
  }
}

export function useUserRole() {
  const [role, setRole] = useState<RoleInfo>()

  useEffect(() => {
    API.get<RoleInfo>('/role').then(response => {
      setRole(response.data)
    }).catch(() => {return})
  }, []);

  return role;
}

export async function getClanForbid() {
	const response = await API.get<DefaultResponse>('/clan_forbid');
	return response.data;
}

export async function putClanForbid(accs: string) {
	const response = await API.put<DefaultResponse>('/clan_forbid', {
		accs: accs,
	});
	return response.data;
}

export async function getUserInfo() {
  const response = await API.get<UserInfoResponse>('/account');
  return response.data;
}

export async function putUserInfo(userInfo: UserInfoResponse) {
  const response = await API.put<DefaultResponse>('/account', userInfo);
  return response.data;
}

export async function postAccountImport(file: File) {
  const formData = new FormData();
  formData.append('file', file);
  const response = await API.post<DefaultResponse>('/account/import', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  clearCachedAccountConfigs();
  return response.data;
}

export async function postAccount(alias: string) {
  const response = await API.post<DefaultResponse>(`/account`, {
    alias: alias,
  });
  return response.data;
}

export async function deleteAccount() {
  const response = await API.delete<DefaultResponse>(`/`);
  clearCachedAccountConfigs();
  return response.data;
}

export async function clearAccounts() {
  const response = await API.delete<DefaultResponse>(`/account`);
  clearCachedAccountConfigs();
  return response.data;
}

export async function postAccountSyncConfig(alias: string) {
  const response = await API.post<DefaultResponse>(`/account/sync`, {
    alias: alias,
  });
  clearCachedAccountConfigs(alias);
  return response.data;
}

export async function getAccount(alias: string) {
  const response = await API.get<AccountResponse>(`/account/${alias}`);
  return response.data;
}

export async function delAccount(alias: string) {
  const response = await API.delete<DefaultResponse>(`/account/${alias}`);
  clearCachedAccountConfigs(alias);
  return response.data;
}

export async function putAccount(alias: string, account: string, password: string, channel: string, batch_accounts: (string | number)[]) {
  const response = await API.put<DefaultResponse>(`/account/${alias}`, {
    username: account,
    password: password,
    channel: channel,
	batch_accounts: batch_accounts
  });
  return response.data;
}

export async function getAccountConfig(alias: string, area: string) {
  const key = accountConfigCacheKey(alias, area);
  const cached = accountConfigCache.get(key);
  if (cached) {
    cacheAccountConfig(key, cached);
    return cached;
  }

  const pendingRequest = accountConfigRequests.get(key);
  if (pendingRequest) return pendingRequest;

  const requestVersion = accountConfigCacheVersion;
  const request = API.get<ModuleResponse>(`/account/${alias}/${area}`)
    .then((response) => {
      if (requestVersion === accountConfigCacheVersion) {
        cacheAccountConfig(key, response.data);
      }
      return response.data;
    })
    .finally(() => {
      if (accountConfigRequests.get(key) === request) {
        accountConfigRequests.delete(key);
      }
    });

  accountConfigRequests.set(key, request);
  return request;
}

export async function getAccountTopRankUnits(alias: string) {
  const response = await API.get<number[]>(`/account/${encodeURIComponent(alias)}/unit_selection/top_rank`, {
    timeout: 60 * 1000,
  });
  return response.data;
}

export async function putAccountConfig(alias: string, key: string, value: ConfigValue) {
  return putAccountConfigs(alias, {[key]: value})
}

export async function putAccountConfigs(alias: string, configs: Record<string, ConfigValue>) {
  const response = await API.put<DefaultResponse>(`/account/${alias}/config`, configs);
  updateCachedAccountConfigs(alias, configs);
  return response.data;
}

export async function postAccountAreaDaily(alias: string, onProgress?: (progress: string) => void) {
  return runAccountTask<AccountInfo>(alias, 'daily', '清日常', () =>
    API.post(`/account/${encodeURIComponent(alias)}/do_daily`, {}, { skipErrorHandler: true }), onProgress);
}

export async function postAccountAreaSingle(
  alias: string,
  module: string,
  onProgress?: (progress: string) => void,
  title = module,
) {
  return runAccountTask<ResultInfo[]>(alias, module, title, () =>
    API.post(`/account/${encodeURIComponent(alias)}/do_single`, { order: module }, { skipErrorHandler: true }), onProgress);
}

export async function getAccountDailyResultList(alias: string) {
  const response = await API.get<ResultInfo[]>(`/account/${alias}/daily_result`);
  return response.data
}

export async function getAccountDailyResult(alias: string, id: number) {
  const response = await API.get<Blob>(`/account/${alias}/daily_result/${id}`,
    {
		responseType: "blob",
		timeout: 1 * 60 * 1000
  });
  const imageUrl = window.URL.createObjectURL(response.data);
  return imageUrl
}

export async function getAccountAreaSingleResultList(alias: string, module: string) {
  const response = await API.get<ResultInfo[]>(`/account/${alias}/single_result/${module}`);
  return response.data
}

export async function getAccountAreaSingleResult(alias: string, module: string, text: boolean) {
  const response = await API.get<Blob | ModuleResult>(`/account/${alias}/single_result/${module}?text=${text}`,
    {
		responseType: "blob",
		timeout: 1 * 60 * 1000
  });
  if (text) {
    return response.data as ModuleResult;
  } else{
    const imageUrl = window.URL.createObjectURL(response.data as Blob);
    return imageUrl
  }
}

export async function getAllUsers() {
  const response = await API.get<UserInfo[]>('/user');
  return response.data;
}

export async function postUser(account: string, userInfo: UserInfo) {
  const response = await API.post<DefaultResponse>(`/user/${account}`, userInfo);
  return response.data;
}

export async function putUser(account: string, userInfo: UserInfo) {
  const response = await API.put<DefaultResponse>(`/user/${account}`, userInfo);
  return response.data;
}

export async function deleteUser(account: string) {
  const response = await API.delete<DefaultResponse>(`/user/${account}`);
  return response.data;
}

export async function getAccountValidate() {
  const response = await API.get<ValidateResponse>(`/query_validate`);
  return response.data;
}

export async function postAccountValidate(id: string, challenge: string, validate: string, userid: string) {
  const response = await API.post<DefaultResponse>(`/validate`, {
    id: id,
    challenge: challenge,
    validate: validate,
    userid: userid
  });
  return response.data;
}

export async function getRunningStatus() {
  const response = await API.get<RunningStatusResponse>(`/running_status`);
  return response.data;
}
