export type SystemStats = {
  timestamp: number;
  cpu: {
    systemPercent: number;
    appPercent: number;
    cores: number;
    model: string;
  };
  gpu: {
    percent: number | null;
  };
  memory: {
    totalBytes: number;
    usedBytes: number;
    appBytes: number;
  };
  disk: {
    totalBytes: number;
    freeBytes: number;
    activityBytesPerSecond: number | null;
  };
};

export type ProcessEntry = {
  name: string;
  cpuPercent: number;
  memoryBytes: number;
  instances: number;
};

export type ProcessSnapshot = {
  applications: ProcessEntry[];
  background: ProcessEntry[];
};
