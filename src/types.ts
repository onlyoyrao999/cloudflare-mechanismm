export interface DrawRecord {
  period: string;
  numbers: number[];
  date?: string;
}

export interface TriggerEvent {
  period: string;
  position: number;
  targetNumber: number;
  sandwichNumber: number;
  basePosition: number;
  trackingWindow: string[];
  status: 'In Progress' | 'Hit' | 'Miss';
  hitPeriodIndex?: number;
  hitPeriod?: string;
  hitPosition?: number;
}

export interface ExclusionPrediction {
  period: string;
  predictedNumbers: number[];
  actualNumbers?: number[];
  isSuccessful?: boolean;
  hitNumbers?: number[];
}

export interface FrequencyStats {
  number: number;
  frequency: number;
  omission: number;
  lastSeenPeriod: string;
}

export interface PredictionReasoning {
  triggerLocking: string;
  edgeDeduction: string;
  omissionConclusion: string;
}

export interface ActiveTarget {
  number: number;
  period: string;
  basePos: number;
  remainingPeriods: number;
}

export interface CurrentPrediction {
  predictedNumbers: number[];
  activeTargets: ActiveTarget[];
  reasoning: PredictionReasoning;
  isAIPowered?: boolean;
}

export interface AnalysisSummary {
  totalDraws: number;
  totalTriggers: number;
  totalHits: number;
  totalHit1To4: number;
  totalHit5To8: number;
  totalMisses: number;
  totalInProgress: number;
  overallHitRate: number;
  hitRate1To4: number;
  hitRate5To8: number;
  exclusionSuccessRate: number;
}

export interface AnalyzeAPIResponse {
  latestDraw: DrawRecord;
  summary: AnalysisSummary;
  triggers: TriggerEvent[];
  predictions: ExclusionPrediction[];
  frequencyStats: FrequencyStats[];
  prediction: CurrentPrediction;
  totalCount: number;
}
