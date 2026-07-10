'use client';

import { useState, useEffect, useCallback } from 'react';

export type CloudEnvStatus = 'active' | 'broken' | 'stopped';
export type StorageTier = 25 | 50 | 100 | 500;

export type CloudEnvLicense =
    | 'unlicense'
    | 'mit'
    | 'bsd-2-clause'
    | 'zlib'
    | 'lgpl'
    | 'mpl-2.0'
    | 'apache-2.0';

export interface CloudFile {
    name: string;
    content: string;
    size: number;
    type: string;
    uploadedAt: string;
}

export interface CloudEnvVisibility {
    showFiles: boolean;
    showLogs: boolean;
    showConsole: boolean;
}

export interface CloudEnvironment {
    id: string;
    name: string;
    slug: string;
    description?: string;
    storageLimitMb: StorageTier;
    photoUrl?: string;
    hasReadme: boolean;
    license: CloudEnvLicense;
    status: CloudEnvStatus;
    files: CloudFile[];
    createdAt: string;
    authorizedEmails?: string[];
    visibility?: CloudEnvVisibility;
}

const STORAGE_KEY = 'tripplet_cloud_envs';

function load(): CloudEnvironment[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function save(envs: CloudEnvironment[]) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(envs));
        window.dispatchEvent(new Event('cloud_envs_updated'));
    } catch { /* quota exceeded */ }
}

export function useCloudEnvironments() {
    const [envs, setEnvs] = useState<CloudEnvironment[]>([]);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        setEnvs(load());
        setLoaded(true);
        const handler = () => setEnvs(load());
        window.addEventListener('cloud_envs_updated', handler);
        return () => window.removeEventListener('cloud_envs_updated', handler);
    }, []);

    const create = useCallback((env: Omit<CloudEnvironment, 'id' | 'createdAt' | 'files' | 'status'>): CloudEnvironment => {
        const newEnv: CloudEnvironment = {
            ...env,
            id: crypto.randomUUID(),
            status: 'active',
            files: [],
            createdAt: new Date().toISOString(),
        };
        const updated = [newEnv, ...load()];
        save(updated);
        setEnvs(updated);
        return newEnv;
    }, []);

    const update = useCallback((id: string, patch: Partial<CloudEnvironment>) => {
        const updated = load().map(e => e.id === id ? { ...e, ...patch } : e);
        save(updated);
        setEnvs(updated);
    }, []);

    const remove = useCallback((id: string) => {
        const updated = load().filter(e => e.id !== id);
        save(updated);
        setEnvs(updated);
    }, []);

    const addFile = useCallback((id: string, file: CloudFile) => {
        const all = load();
        const env = all.find(e => e.id === id);
        if (!env) return;
        const files = [...env.files.filter(f => f.name !== file.name), file];
        const updated = all.map(e => e.id === id ? { ...e, files } : e);
        save(updated);
        setEnvs(updated);
    }, []);

    const removeFile = useCallback((envId: string, fileName: string) => {
        const all = load();
        const updated = all.map(e => e.id === envId ? { ...e, files: e.files.filter(f => f.name !== fileName) } : e);
        save(updated);
        setEnvs(updated);
    }, []);

    const usedBytes = useCallback((env: CloudEnvironment) =>
        env.files.reduce((acc, f) => acc + f.size, 0), []);

    return { envs, loaded, create, update, remove, addFile, removeFile, usedBytes };
}
