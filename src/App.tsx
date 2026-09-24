import { useState, useEffect, useMemo } from 'react';
import { 
  RefreshCw, 
  Activity, 
  TrendingDown, 
  TrendingUp, 
  CheckCircle2, 
  XCircle, 
  HelpCircle, 
  Database, 
  Calendar, 
  Compass, 
  Sparkles, 
  AlertCircle,
  FileText,
  Clock,
  BookOpen,
  ChevronRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { DrawRecord, TriggerEvent, ExclusionPrediction, FrequencyStats, AnalyzeAPIResponse } from './types.js';

// Firebase Integrations
import { auth, googleProvider, db, handleFirestoreError, OperationType } from './firebase.js';
import { signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { doc, setDoc, deleteDoc, collection, query, where, onSnapshot, serverTimestamp } from 'firebase/firestore';

export default function App() {
  const [data, setData] = useState<AnalyzeAPIResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // AI report state
  const [aiReport, setAiReport] = useState<string | null>(null);
  const [generatingAi, setGeneratingAi] = useState<boolean>(false);

  // Active interactive tabs & filters
  const [activeTab, setActiveTab] = useState<'prediction' | 'backtest' | 'heatmap'>('prediction');
  const [gridMetric, setGridMetric] = useState<'frequency' | 'omission'>('frequency');
  const [selectedTrigger, setSelectedTrigger] = useState<TriggerEvent | null>(null);

  // Firebase auth & workspace states
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [savedPredictions, setSavedPredictions] = useState<any[]>([]);
  const [myTracker, setMyTracker] = useState<any>(null);
  const [savingPrediction, setSavingPrediction] = useState<boolean>(false);
  const [newPredictionNote, setNewPredictionNote] = useState<string>('');

  // Handle Firebase Auth live sync subscription
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);

      if (currentUser) {
        // Live sync saved predictions list for active user
        const qPredictions = query(
          collection(db, 'saved_predictions'),
          where('userId', '==', currentUser.uid)
        );
        const unsubPredictions = onSnapshot(qPredictions, (snapshot) => {
          const list: any[] = [];
          snapshot.forEach((doc) => {
            list.push({ id: doc.id, ...doc.data() });
          });
          // Sort items by createdAt descending
          list.sort((a, b) => {
            const timeA = a.createdAt?.seconds ? a.createdAt.seconds * 1000 : new Date(a.createdAt || 0).getTime();
            const timeB = b.createdAt?.seconds ? b.createdAt.seconds * 1000 : new Date(b.createdAt || 0).getTime();
            return timeB - timeA;
          });
          setSavedPredictions(list);
        }, (err) => {
          console.error("Failed syncing saved predictions:", err);
          try {
            handleFirestoreError(err, OperationType.LIST, 'saved_predictions');
          } catch (e: any) {
            setError("Firestore predictions sync issue: " + e.message);
          }
        });

        // Live sync specific tracker for active user
        const trackerRef = doc(db, 'user_trackers', currentUser.uid);
        const unsubTracker = onSnapshot(trackerRef, (docSnap) => {
          if (docSnap.exists()) {
            setMyTracker(docSnap.data());
          } else {
            setMyTracker(null);
          }
        }, (err) => {
          console.error("Failed syncing user tracker:", err);
          try {
            handleFirestoreError(err, OperationType.GET, `user_trackers/${currentUser.uid}`);
          } catch (e: any) {
            setError("Firestore trackers sync issue: " + e.message);
          }
        });

        return () => {
          unsubPredictions();
          unsubTracker();
        };
      } else {
        setSavedPredictions([]);
        setMyTracker(null);
      }
    });

    return () => unsubscribe();
  }, []);

  // Firebase auth helper triggers
  const loginWithGoogle = async () => {
    try {
      setError(null);
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      console.error("Google Login failed:", err);
      setError("Google Login failed: " + err.message);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (err: any) {
      console.error("Sign Out failed:", err);
    }
  };

  // Helper: Save prediction record with notes
  const saveCurrentPrediction = async () => {
    if (!user || !data || !data.prediction) return;
    setSavingPrediction(true);
    setError(null);
    const path = 'saved_predictions';
    const currentPeriod = data.latestDraw?.period || '';
    const nextPeriod = (parseInt(currentPeriod, 10) + 1).toString();
    try {
      const predId = `${user.uid}_${nextPeriod}`;
      await setDoc(doc(db, path, predId), {
        userId: user.uid,
        period: nextPeriod,
        predictedNumbers: data.prediction.predictedNumbers,
        notes: newPredictionNote,
        createdAt: serverTimestamp(),
      });
      setNewPredictionNote('');
    } catch (err: any) {
      console.error("Failed saving prediction to cloud:", err);
      try {
        handleFirestoreError(err, OperationType.CREATE, `${path}/${user.uid}_${nextPeriod}`);
      } catch (jsonErr: any) {
        setError("Error saving prediction notes: " + jsonErr.message);
      }
    } finally {
      setSavingPrediction(false);
    }
  };

  // Helper: Toggle tracked tracker alarms
  const toggleTrackedNumber = async (num: number) => {
    if (!user) return;
    const trackerRef = doc(db, 'user_trackers', user.uid);
    const currentNumbers = myTracker?.monitoredNumbers || [];
    let updatedNumbers: number[];
    if (currentNumbers.includes(num)) {
      updatedNumbers = currentNumbers.filter((n: number) => n !== num);
    } else {
      updatedNumbers = [...currentNumbers, num];
    }

    try {
      await setDoc(trackerRef, {
        userId: user.uid,
        monitoredNumbers: updatedNumbers,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch (err: any) {
      console.error("Failed updating user tracker setup:", err);
      try {
        handleFirestoreError(err, OperationType.WRITE, `user_trackers/${user.uid}`);
      } catch (jsonErr: any) {
        setError("Error setting custom radar values: " + jsonErr.message);
      }
    }
  };

  // Fetch all analyzer data from our Express server API
  const fetchAnalysis = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/analyze');
      if (!response.ok) {
        throw new Error(`分析初始化失败: HTTP ${response.status}`);
      }
      const rawData: AnalyzeAPIResponse = await response.json();
      setData(rawData);
      
      // Auto-select latest trigger if available
      if (rawData.triggers && rawData.triggers.length > 0) {
        setSelectedTrigger(rawData.triggers[rawData.triggers.length - 1]);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || '获取分析模型失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchAnalysis();
  }, []);

  // Force scraping updates from targets
  const forceRefreshScraper = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch('/api/refresh', { method: 'POST' });
      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.message || '强制更新抓取失败');
      }
      // Re-fetch analyzer models after successful scrape
      await fetchAnalysis(true);
    } catch (err: any) {
      console.error(err);
      setError(err.message || '强制同步服务器数据失败');
      setRefreshing(false);
    }
  };

  // Generate Gemini AI narrative report
  const requestAiReport = async () => {
    if (!data) return;
    setGeneratingAi(true);
    setAiReport(null);
    try {
      const res = await fetch('/api/ai-report', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prediction: data.prediction,
          summary: data.summary,
          latestDraw: data.latestDraw,
        }),
      });
      if (!res.ok) {
        throw new Error('AI 生成报告失败');
      }
      const result = await res.json();
      setAiReport(result.content);
    } catch (err: any) {
      console.error(err);
      setAiReport(`### ❌ 报告生成失败\n\n${err.message || '无法联系 Gemini 专家模型。请确保网络畅通，或在 AI Studio "Secrets" 页面中绑定正确的 GEMINI_API_KEY。'}`);
    } finally {
      setGeneratingAi(false);
    }
  };

  // Calculate circular list of predictions to show beautifully
  const circularPathPositions = useMemo(() => {
    if (!selectedTrigger) return [];
    const P = selectedTrigger.basePosition;
    if (P === 1) return [1, 2, 7];
    if (P === 7) return [6, 7, 1];
    return [P - 1, P, P + 1];
  }, [selectedTrigger]);

  // Sort candidates of 49 numbers dynamically based on metrics
  const sortedStats = useMemo(() => {
    if (!data) return [];
    return [...data.frequencyStats].sort((a, b) => {
      if (gridMetric === 'frequency') {
        return b.frequency - a.frequency; // Hottest first
      } else {
        return b.omission - a.omission; // Longest omission first
      }
    });
  }, [data, gridMetric]);

  // Average prediction individual escaping rate (Accuracy per number)
  const averageIndividualAccuracy = useMemo(() => {
    if (!data || !data.predictions || data.predictions.length === 0) return 0;
    const totalPredictions = data.predictions.length;
    let sumHitRatio = 0;
    data.predictions.forEach(p => {
      // ratio of non-appearing numbers = (6 - hits) / 6
      const hitCount = p.hitNumbers ? p.hitNumbers.length : 0;
      sumHitRatio += (6 - hitCount) / 6;
    });
    return (sumHitRatio / totalPredictions) * 100;
  }, [data]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 font-sans">
        <div className="flex flex-col items-center max-w-sm text-center">
          <motion.div 
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
            className="w-16 h-16 border-4 border-indigo-500 border-t-transparent rounded-full mb-6"
          />
          <h2 className="text-xl font-medium tracking-tight text-white mb-2">正在初始化数据模型</h2>
          <p className="text-sm text-slate-400">正在分析大盘开奖轨迹，解压环形边缘矩阵并归置冷态频率指数...</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6">
        <div className="bg-slate-900 border border-slate-800 p-8 rounded-2xl max-w-md text-center shadow-xl">
          <AlertCircle className="w-12 h-12 text-rose-500 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-white mb-2">加载模型出错</h2>
          <p className="text-slate-400 text-sm mb-6">{error || '未找到历史数据'}</p>
          <button 
            onClick={() => fetchAnalysis()}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium transition cursor-pointer"
          >
            重试重置
          </button>
        </div>
      </div>
    );
  }

  const { latestDraw, summary, prediction, predictions, triggers } = data;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-indigo-500/30">
      
      {/* BACKGROUND EFFECTS */}
      <div className="absolute top-0 left-0 w-full h-[500px] bg-gradient-to-b from-indigo-950/20 via-slate-950/0 to-slate-950/0 pointer-events-none" />

      {/* TOP HEADER */}
      <header className="sticky top-0 z-40 bg-slate-950/80 backdrop-blur-md border-b border-slate-900 px-4 py-4 md:px-8">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          
          {/* Logo Title */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <h1 className="text-lg font-bold tracking-tight text-white">MacauJC 赛马数字轨迹分析系统</h1>
              <span className="text-[10px] bg-slate-900 border border-slate-800 text-slate-400 px-1.5 py-0.5 rounded font-mono">Expert V1.2</span>
            </div>
            <p className="text-xs text-slate-400">
              采用隔期跳跃触发机制锁定夹心变动，通过环形邻轨排除策略精炼 6 位不出现号码
            </p>
          </div>

          {/* Sync Stats & Triggers */}
          <div className="flex items-center justify-between md:justify-end gap-3 flex-wrap">
            <div className="flex items-center gap-3 text-[11px] font-mono bg-slate-900 border border-slate-850 px-3 py-1.5 rounded-lg text-slate-400">
              <div className="flex items-center gap-1">
                <Database className="w-3.5 h-3.5 text-blue-400" />
                <span>大盘数: <strong>{data.latestDraw?.period ? (parseInt(data.latestDraw.period.slice(4), 10) + 1) : data.totalCount}</strong> 期</span>
              </div>
              <span className="text-slate-800">|</span>
              <div className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                <span>更新周期: <strong>每日 21:35 PM</strong></span>
              </div>
            </div>

            <button
              onClick={forceRefreshScraper}
              disabled={refreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-850 border border-slate-800 rounded-lg text-xs font-medium text-slate-200 hover:text-white transition cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span>{refreshing ? '正在抓取同步...' : '极速强制同步'}</span>
            </button>

            {/* Firebase Auth User Status Widget */}
            {authLoading ? (
              <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            ) : user ? (
              <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 py-1 px-2.5 rounded-lg">
                {user.photoURL ? (
                  <img 
                    src={user.photoURL} 
                    alt={user.displayName || ''} 
                    className="w-5 h-5 rounded-full ring-1 ring-indigo-500/50" 
                    referrerPolicy="no-referrer" 
                  />
                ) : (
                  <div className="w-5 h-5 rounded-full bg-indigo-600 flex items-center justify-center font-bold text-[10px] uppercase text-white">
                    {user.displayName ? user.displayName[0] : 'U'}
                  </div>
                )}
                <div className="hidden sm:flex flex-col text-[10px] items-start leading-none max-w-[80px]">
                  <span className="text-white font-medium truncate w-full">
                    {user.displayName || '已登录'}
                  </span>
                </div>
                <button
                  onClick={handleSignOut}
                  className="ml-1 px-1.5 py-0.5 bg-slate-950 text-[10px] text-slate-400 hover:text-rose-400 border border-slate-850 hover:border-rose-950/50 rounded font-medium transition cursor-pointer"
                >
                  注销
                </button>
              </div>
            ) : (
              <button
                onClick={loginWithGoogle}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-xs font-semibold text-white transition cursor-pointer shadow-md"
              >
                <Sparkles className="w-3.5 h-3.5 text-white/90 animate-pulse" />
                <span>Google 登录</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ERROR MESSAGE NOTIFICATION */}
      {error && (
        <div className="bg-rose-950/40 border-b border-rose-900/50 text-rose-300 text-xs py-3 px-4 md:px-8">
          <div className="max-w-7xl mx-auto flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* D盘主布局 */}
      <main className="max-w-7xl mx-auto px-4 py-6 md:px-8 md:py-8 grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* ======================= LEFT METRICS BLOCK (4 COLS) ======================= */}
        <section className="lg:col-span-4 flex flex-col gap-6">
          
          {/* LATEST DRAW DISPLAY */}
          <div className="bg-slate-900/50 border border-slate-900 p-5 rounded-2xl">
            <h3 className="text-xs font-mono font-medium tracking-wider text-slate-400 uppercase mb-3 flex items-center justify-between">
              <span>最新开奖归档</span>
              <span className="text-indigo-400">第 {latestDraw.period} 期</span>
            </h3>
            <div className="flex items-center gap-1.5 flex-wrap">
              {latestDraw.numbers.map((num, idx) => (
                <div 
                  key={idx} 
                  className={`w-10 h-10 rounded-xl flex items-center justify-center font-mono font-bold text-sm shadow-inner transition ${
                    idx === 6 
                      ? 'bg-rose-950/50 border border-rose-900 text-rose-300' // Special number/Bonus 
                      : 'bg-slate-950 border border-slate-800 text-white'
                  }`}
                >
                  {num.toString().padStart(2, '0')}
                </div>
              ))}
            </div>
            {latestDraw.numbers.length > 6 && (
              <p className="text-[10px] text-slate-500 mt-2 font-mono flex justify-end">
                前 6 位为常规名次，第 7 位为隔期对冲名次
              </p>
            )}
          </div>

          {/* TRAJECTORY ACCURACY METER */}
          <div className="bg-slate-900/50 border border-slate-900 p-5 rounded-2xl flex flex-col gap-4">
            
            <div>
              <h3 className="text-xs font-mono font-medium text-slate-400 mb-1 uppercase tracking-wider">
                轨迹回补回测精度
              </h3>
              <p className="text-[11px] text-slate-500">
                观察目标号 X 在隔期跳跃触发后，于随后 8 期内回补高几率区
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-950/60 border border-slate-900 p-3 rounded-xl text-center">
                <span className="text-2xl font-bold font-mono tracking-tight text-indigo-400">
                  {(summary.overallHitRate * 100).toFixed(1)}%
                </span>
                <span className="block text-[10px] text-slate-500 mt-0.5">闭合总回补率</span>
              </div>
              <div className="bg-slate-950/60 border border-slate-900 p-3 rounded-xl text-center">
                <span className="text-2xl font-bold font-mono tracking-tight text-emerald-400">
                  {(summary.hitRate1To4 * 100).toFixed(1)}%
                </span>
                <span className="block text-[10px] text-slate-500 mt-0.5">1-4期高发占比</span>
              </div>
            </div>

            {/* BAR COMPASS */}
            <div className="space-y-2 text-xs font-mono">
              <div className="flex justify-between items-center text-[11px]">
                <span className="text-slate-400">轨迹触发样本数</span>
                <span className="text-slate-300 font-semibold">{summary.totalTriggers} 次</span>
              </div>
              <div className="flex justify-between items-center text-[11px]">
                <span className="text-emerald-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  1-4期快速追进
                </span>
                <span className="text-slate-300 font-semibold">{summary.totalHit1To4} 次</span>
              </div>
              <div className="flex justify-between items-center text-[11px]">
                <span className="text-blue-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                  5-8期延迟回补
                </span>
                <span className="text-slate-300 font-semibold">{summary.totalHit5To8} 次</span>
              </div>
              <div className="flex justify-between items-center text-[11px]">
                <span className="text-rose-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                  未回补出界 (Miss)
                </span>
                <span className="text-slate-300 font-semibold">{summary.totalMisses} 次</span>
              </div>
            </div>

            {/* STAT PROGRESS VISUALIZER */}
            <div className="w-full bg-slate-950 h-2.5 rounded-full overflow-hidden flex border border-slate-905">
              <div 
                style={{ width: `${(summary.totalHit1To4 / summary.totalTriggers) * 100}%` }}
                className="bg-emerald-500 h-full"
                title={`1-4期: ${summary.totalHit1To4} 次`}
              />
              <div 
                style={{ width: `${(summary.totalHit5To8 / summary.totalTriggers) * 100}%` }}
                className="bg-blue-500 h-full"
                title={`5-8期: ${summary.totalHit5To8} 次`}
              />
              <div 
                style={{ width: `${(summary.totalMisses / summary.totalTriggers) * 100}%` }}
                className="bg-rose-500/80 h-full"
                title={`未回补: ${summary.totalMisses} 次`}
              />
            </div>
          </div>

          {/* EXCLUSION ENGINE EFFICIENCY */}
          <div className="bg-slate-900/50 border border-slate-900 p-5 rounded-2xl flex flex-col gap-4">
            <div>
              <h3 className="text-xs font-mono font-medium text-slate-400 mb-1 uppercase tracking-wider">
                专家排除算法绩效
              </h3>
              <p className="text-[11px] text-slate-500">
                双重对冲防线下的 6 号排除算法在 165 期历史中的真实准确性
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-950/60 border border-slate-900 p-3 rounded-xl text-center">
                <span className="text-2xl font-bold font-mono tracking-tight text-indigo-400">
                  {averageIndividualAccuracy.toFixed(1)}%
                </span>
                <span className="block text-[10px] text-slate-500 mt-0.5">单号排除成功率</span>
              </div>
              <div className="bg-slate-950/60 border border-slate-900 p-3 rounded-xl text-center">
                <span className="text-2xl font-bold font-mono tracking-tight text-white">
                  {(summary.exclusionSuccessRate * 100).toFixed(1)}%
                </span>
                <span className="block text-[10px] text-slate-500 mt-0.5">6码全面成功率</span>
              </div>
            </div>

            <div className="bg-indigo-950/20 border border-indigo-900/30 p-3 rounded-xl flex items-start gap-2.5">
              <Sparkles className="w-4 h-4 text-indigo-400 flex-shrink-0 mt-0.5" />
              <div className="text-[11px] text-slate-400 space-y-1">
                <p><strong>防共振对冲保驾</strong>：每一期预测都将剔除当前活跃在追逐路径上的号码目标；并强制在最近期排除名单过滤，契合严密。每期皆 100% 自动对碰复盘。</p>
              </div>
            </div>
          </div>

        </section>

        {/* ======================= RIGHT CONTENT CANVAS (8 COLS) ======================= */}
        <section className="lg:col-span-8 flex flex-col gap-6">

          {/* INNER NAVIGATION TABS */}
          <div className="flex border-b border-slate-900 gap-1 overflow-x-auto">
            <button
              onClick={() => { setActiveTab('prediction'); setAiReport(null); }}
              className={`px-5 py-2.5 text-sm font-medium transition whitespace-nowrap cursor-pointer relative ${
                activeTab === 'prediction' 
                  ? 'text-white border-b-2 border-indigo-500' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <Compass className="w-4 h-4" />
                <span>下一期不出现 6 码预测</span>
              </div>
            </button>
            <button
              onClick={() => setActiveTab('backtest')}
              className={`px-5 py-2.5 text-sm font-medium transition whitespace-nowrap cursor-pointer relative ${
                activeTab === 'backtest' 
                  ? 'text-white border-b-2 border-indigo-500' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <Activity className="w-4 h-4" />
                <span>大盘轨迹回测大盘</span>
              </div>
            </button>
            <button
              onClick={() => setActiveTab('heatmap')}
              className={`px-5 py-2.5 text-sm font-medium transition whitespace-nowrap cursor-pointer relative ${
                activeTab === 'heatmap' 
                  ? 'text-white border-b-2 border-indigo-500' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4" />
                <span>全49码冷热与遗漏分布</span>
              </div>
            </button>
          </div>

          {/* TAB VIEW 1: DYNAMICAL PREDICTIONS */}
          {activeTab === 'prediction' && (
            <div className="flex flex-col gap-6">
              
              {/* PRIMARY PREDICTION CARD */}
              <div className="bg-slate-900/40 border border-indigo-950/50 p-6 rounded-3xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />
                
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                  <div>
                    <span className="text-[10px] font-mono tracking-widest text-indigo-400 font-bold uppercase block mb-1">
                      UPCOMING DRAW PREDICTION
                    </span>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-xl font-bold text-white tracking-tight">
                        新一期极低概率（排除） 6 个号码
                      </h2>
                      {prediction.isAIPowered ? (
                        <span className="text-[10.5px] bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 px-2 py-0.5 rounded-full font-medium flex items-center gap-1 shadow-sm">
                          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
                          Gemini 3.5 智能预测
                        </span>
                      ) : (
                        <span className="text-[10.5px] bg-slate-950 border border-slate-800 text-slate-400 px-2 py-0.5 rounded-full font-medium">
                          高精度数理对冲运算
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-slate-400">预测下期目标</span>
                    <span className="block text-sm font-mono font-bold text-indigo-400">
                      第 {(parseInt(latestDraw.period, 10) + 1).toString()} 期
                    </span>
                  </div>
                </div>

                {/* THE 6 EXCLUDED BALLS */}
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-6">
                  {prediction.predictedNumbers.map((num, idx) => (
                    <div 
                      key={idx} 
                      className="bg-slate-950 border border-slate-800 rounded-2xl p-4 flex flex-col items-center justify-center shadow-lg group hover:border-slate-700/80 transition"
                    >
                      <div className="w-12 h-12 bg-slate-900 border border-slate-800 rounded-full flex items-center justify-center font-mono text-lg font-extrabold text-slate-300 mb-2 shadow-inner group-hover:text-indigo-400 transition">
                        {num.toString().padStart(2, '0')}
                      </div>
                      <span className="text-[10px] font-mono text-slate-500">不可能出现</span>
                    </div>
                  ))}
                </div>

                {/* RULES MET */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs border-t border-slate-850 pt-5">
                  <div className="flex gap-2 text-slate-400">
                    <CheckCircle2 className="w-4 h-4 text-indigo-400 flex-shrink-0" />
                    <div>
                      <strong className="text-slate-200 block mb-0.5">防重叠排除</strong>
                      <p className="text-[10px] text-slate-500">已自动核对并排除第 {latestDraw.period} 期的名单，确保上一期预测不重复。</p>
                    </div>
                  </div>
                  <div className="flex gap-2 text-slate-400">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    <div>
                      <strong className="text-slate-200 block mb-0.5">数理对冲屏蔽</strong>
                      <p className="text-[10px] text-slate-500">检测出 {prediction.activeTargets.length} 个正在追赶变移路径上的活跃重叠号并自动加锁，100%不入排除池。</p>
                    </div>
                  </div>
                  <div className="flex gap-2 text-slate-400">
                    <CheckCircle2 className="w-4 h-4 text-blue-400 flex-shrink-0" />
                    <div>
                      <strong className="text-slate-200 block mb-0.5">冷热平衡偏向</strong>
                      <p className="text-[10px] text-slate-500">对495期历史冷指标进行扫描，聚焦于当前失衡的极端冷滞号码和被套遗漏波峰号码。</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* THREE REASONING TABS (USER EXPLICIT REQUEST FORMATED AS ACCORDION) */}
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-2 mb-1">
                  <BookOpen className="w-4.5 h-4.5 text-indigo-400" />
                  <h3 className="text-sm font-semibold text-white">
                    {prediction.isAIPowered ? "Gemini AI 高阶数理推理分析" : "高阶算法数理推理报告"} (Reasoning Log)
                  </h3>
                </div>

                <div className="bg-slate-900/30 border border-slate-900 rounded-2xl overflow-hidden divide-y divide-slate-900">
                  
                  {/* TRIGGER SUMMARY */}
                  <div className="p-5">
                    <h4 className="text-xs font-mono font-bold text-slate-200 mb-2 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full" />
                      触发特征与号码锁定 (Trigger Characteristics & Number Locking)
                    </h4>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      {prediction.reasoning.triggerLocking}
                    </p>
                  </div>

                  {/* EDGE DEDUCTION */}
                  <div className="p-5">
                    <h4 className="text-xs font-mono font-bold text-slate-200 mb-2 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full" />
                      边缘算法与路径推演 (Edge Algorithm & Path Deduction)
                    </h4>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      {prediction.reasoning.edgeDeduction}
                    </p>
                  </div>

                  {/* EXCLUSION ANALYSIS */}
                  <div className="p-5">
                    <h4 className="text-xs font-mono font-bold text-slate-200 mb-2 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 bg-blue-400 rounded-full" />
                      遗漏分析与排除结论 (Omission Analysis & Exclusion Conclusion)
                    </h4>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      {prediction.reasoning.omissionConclusion}
                    </p>
                  </div>
                </div>
              </div>

              {/* LIVE AI GEMINI DEEP CONSULTATION ESSAY */}
              <div className="bg-slate-900/30 border border-slate-900 rounded-2xl p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                  <div>
                    <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                      <Sparkles className="w-4.5 h-4.5 text-indigo-400 animate-pulse" />
                      <span>Gemini 专家混炼学术深度报告</span>
                    </h3>
                    <p className="text-xs text-slate-500">
                      基于本期运算参数与 495 期完整底盘，传召大模型撰写深度学派报告
                    </p>
                  </div>
                  <button
                    onClick={requestAiReport}
                    disabled={generatingAi}
                    className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold shadow-md transition cursor-pointer self-start sm:self-center"
                  >
                    {generatingAi ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>正在传译撰写中...</span>
                      </>
                    ) : (
                      <>
                        <FileText className="w-3.5 h-3.5" />
                        <span>一键生成学术报告</span>
                      </>
                    )}
                  </button>
                </div>

                <AnimatePresence mode="wait">
                  {aiReport ? (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="bg-slate-950/80 border border-slate-850 p-5 rounded-xl prose max-w-none text-xs text-slate-300 leading-relaxed font-sans max-h-96 overflow-y-auto whitespace-pre-line"
                    >
                      {aiReport}
                    </motion.div>
                  ) : generatingAi ? (
                    <div className="bg-slate-950/50 border border-slate-900 py-10 rounded-xl flex flex-col items-center justify-center text-slate-400 text-xs">
                      <motion.div 
                        animate={{ scale: [1, 1.1, 1] }}
                        transition={{ repeat: Infinity, duration: 1.5 }}
                        className="w-12 h-12 bg-indigo-500/10 rounded-full flex items-center justify-center text-indigo-500 mb-3"
                      >
                        <Sparkles className="w-5 h-5" />
                      </motion.div>
                      <span>专家模型正在测算轨迹并演算混沌模型...</span>
                    </div>
                  ) : (
                    <div className="bg-slate-950/40 border border-dashed border-slate-850 p-6 rounded-xl text-center text-slate-500 text-xs">
                      点击上方 “一键生成学术报告” 按钮，激活 Gemini API 撰写具有高等统计混沌学说服力的分析手稿。
                    </div>
                  )}
                </AnimatePresence>
              </div>

              {/* FIREBASE AUTH COLLABORATIVE INTERACTION BOX */}
              {user ? (
                <div className="bg-slate-900/40 border border-slate-900 p-6 rounded-3xl relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 rounded-full blur-2xl pointer-events-none" />
                  
                  <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-1.5">
                    <Database className="w-4 h-4 text-indigo-400" />
                    <span>我的 Firebase 云端排除收藏夹</span>
                  </h3>
                  
                  {/* Save current prediction and note */}
                  <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-850/60 mb-5">
                    <p className="text-xs text-indigo-400 font-mono mb-2 flex items-center gap-1">
                      <span>💾 锁定下期 (第 {(parseInt(latestDraw.period, 10) + 1).toString()} 期) 排除码:</span>
                      <strong className="text-indigo-300 font-bold bg-indigo-950/50 px-1.5 py-0.5 rounded border border-indigo-900/40">
                        {prediction.predictedNumbers.map(n => n.toString().padStart(2, '0')).join(', ')}
                      </strong>
                    </p>
                    <div className="flex flex-col md:flex-row gap-3">
                      <input 
                        type="text"
                        placeholder="在此输入个人对本期预测号码的思路分析或首尾对冲对锁备注 (支持云同步)..."
                        value={newPredictionNote}
                        onChange={(e) => setNewPredictionNote(e.target.value)}
                        className="bg-slate-900 border border-slate-800 text-xs text-slate-100 placeholder-slate-500 px-4 py-2.5 rounded-lg flex-1 focus:outline-none focus:border-indigo-500"
                      />
                      <button
                        onClick={saveCurrentPrediction}
                        disabled={savingPrediction}
                        className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold cursor-pointer transition whitespace-nowrap"
                      >
                        {savingPrediction ? "云端保存中..." : "保存记录至云端"}
                      </button>
                    </div>
                  </div>

                  {/* List of saved records */}
                  {savedPredictions.length > 0 ? (
                    <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                      {savedPredictions.map((saved) => (
                        <div key={saved.id} className="bg-slate-950/40 border border-slate-900/60 p-3.5 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                          <div>
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className="font-mono font-bold text-indigo-400 bg-indigo-950/30 px-2 py-0.5 rounded border border-indigo-900/30">第 {saved.period} 期</span>
                              <span className="text-[10px] text-slate-500 font-mono">
                                {saved.createdAt?.seconds 
                                  ? new Date(saved.createdAt.seconds * 1000).toLocaleString() 
                                  : '刚刚'}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                              <span className="text-slate-400 text-[10px]">云端排除码:</span>
                              <div className="flex gap-1">
                                {saved.predictedNumbers?.map((n: number, i: number) => (
                                  <span key={i} className="bg-slate-900 text-[10.5px] text-slate-350 font-mono font-bold px-1.5 py-0.5 rounded border border-slate-800">
                                    {n.toString().padStart(2, '0')}
                                  </span>
                                ))}
                              </div>
                            </div>
                            {saved.notes && (
                              <p className="text-slate-300 text-[11px] leading-relaxed italic bg-slate-950/50 py-1.5 px-3 rounded mt-1 border-l-2 border-indigo-500/50 font-sans">
                                "{saved.notes}"
                              </p>
                            )}
                          </div>
                          
                          <button
                            onClick={async () => {
                              try {
                                await deleteDoc(doc(db, 'saved_predictions', saved.id));
                              } catch (err) {
                                console.error("Error deleting document:", err);
                              }
                            }}
                            className="text-slate-500 hover:text-rose-400 cursor-pointer self-end sm:self-center transition text-xs font-medium bg-slate-900 px-2.5 py-1 rounded-md border border-slate-850 hover:border-rose-950 hover:bg-rose-955/5"
                          >
                            移除
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-600 text-center py-6 border border-dashed border-slate-900 rounded-2xl bg-slate-950/20">
                      您暂无任何云端排除笔记。在上方输入思路备注，添加您的第一条专属对冲记录吧！
                    </p>
                  )}
                </div>
              ) : (
                <div className="bg-gradient-to-r from-slate-900/55 to-indigo-950/15 border border-slate-900 p-6 rounded-3xl flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-semibold text-white flex items-center gap-1.5 mb-1.5">
                      <Sparkles className="w-4 h-4 text-indigo-400 animate-pulse" />
                      <span>解锁云端学术专属空间 (Firebase Enabled)</span>
                    </h3>
                    <p className="text-xs text-slate-400 leading-relaxed max-w-xl">
                      免费使用 Google 账户登录即可激活冷热排除自选收藏，在云端长期安全保存各期首尾排除笔记，并支持号码矩阵中的实时雷达高亮监控功能。
                    </p>
                  </div>
                  <button 
                    onClick={loginWithGoogle}
                    className="flex items-center gap-2 px-4 shadow-md py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold transition cursor-pointer whitespace-nowrap self-start md:self-center"
                  >
                    <span>Google 账号一键登录</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

            </div>
          )}

          {/* TAB VIEW 2: TRAJECTORY AND EXCLUSION BACKTEST HISTORY */}
          {activeTab === 'backtest' && (
            <div className="flex flex-col gap-6">

              {/* TOP INTRO */}
              <div className="bg-slate-900/30 border border-slate-900 p-5 rounded-2xl">
                <h3 className="text-sm font-semibold text-white mb-1">轨迹规律与排除检验回演 (Data Backtesting)</h3>
                <p className="text-xs text-slate-400">
                  本系统严厉贯彻“无模拟数据，100%全回溯检测”的原则。以下是轨迹回补事件的精细记录与排除推演准确率记录。
                </p>
              </div>

              {/* TRAJECTORY MAP TRACKING (INTERACTIVE SVG ROUNDER) */}
              {selectedTrigger && (
                <div className="bg-slate-900/50 border border-indigo-950/40 p-5 rounded-2xl grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
                  
                  {/* SVG circular track (5 cols) */}
                  <div className="md:col-span-5 flex flex-col items-center justify-center">
                    <span className="text-[10px] font-mono text-indigo-400 uppercase mb-3">
                      基准位 P={selectedTrigger.basePosition} 及其邻轨分布
                    </span>
                    
                    <svg width="200" height="200" viewBox="0 0 220 220" className="w-48 h-48">
                      {/* circular track bg */}
                      <circle cx="110" cy="110" r="80" fill="none" stroke="#1e293b" strokeWidth="3" />
                      {/* circular path indicator links to P-1, P, P+1 */}
                      <circle cx="110" cy="110" r="90" fill="none" stroke="#10b981" strokeWidth="1" strokeDasharray="3 3" opacity="0.3" />

                      {/* Render 7 Position Nodes */}
                      {Array.from({ length: 7 }, (_, index) => {
                        const pos = index + 1;
                        const angle = (index * 360) / 7 - 90; // Start at top
                        const rad = (angle * Math.PI) / 180;
                        const x = 110 + 80 * Math.cos(rad);
                        const y = 110 + 80 * Math.sin(rad);

                        // Highlight properties
                        const isP = pos === selectedTrigger.basePosition;
                        const isBoundaryCheck = circularPathPositions.includes(pos);
                        
                        let strokeColor = '#334155';
                        let fillColor = '#020617';
                        let textColor = '#94a3b8';
                        let strokeWidth = '1';

                        if (isBoundaryCheck) {
                          strokeColor = '#10b981'; // Green
                          fillColor = '#064e3b';
                          textColor = '#a7f3d0';
                          strokeWidth = '2';
                        }
                        if (isP) {
                          strokeColor = '#6366f1'; // Indigo base
                          fillColor = '#1e1b4b';
                          textColor = '#c7d2fe';
                          strokeWidth = '3';
                        }

                        return (
                          <g key={pos} className="cursor-default">
                            {/* Glow */}
                            {(isP || isBoundaryCheck) && (
                              <circle cx={x} cy={y} r="18" fill={isP ? '#4f46e5' : '#10b981'} opacity="0.15" className="animate-pulse" />
                            )}
                            <circle 
                              cx={x} 
                              cy={y} 
                              r="14" 
                              fill={fillColor} 
                              stroke={strokeColor} 
                              strokeWidth={strokeWidth} 
                            />
                            <text 
                              x={x} 
                              y={y + 4} 
                              textAnchor="middle" 
                              fontSize="10" 
                              fontWeight="bold" 
                              fill={textColor}
                              className="font-mono"
                            >
                              {pos}
                            </text>
                            
                            {/* Outer Node label */}
                            <text
                              x={110 + 104 * Math.cos(rad)}
                              y={110 + 104 * Math.sin(rad) + 3}
                              textAnchor="middle"
                              fontSize="8"
                              fill={isP ? '#c7d2fe' : isBoundaryCheck ? '#a7f3d0' : '#475569'}
                              className="font-mono"
                            >
                              {isP ? 'P位' : isBoundaryCheck ? '轨频' : ''}
                            </text>
                          </g>
                        );
                      })}

                      {/* Center Info label */}
                      <text x="110" y="103" textAnchor="middle" fontSize="10" fill="#475569" className="font-mono">目标号</text>
                      <text x="110" y="125" textAnchor="middle" fontSize="18" fontWeight="bold" fill="#ffffff" className="font-mono">
                        {selectedTrigger.targetNumber.toString().padStart(2, '0')}
                      </text>
                    </svg>

                    <div className="flex gap-4 text-[10px] font-mono mt-2">
                      <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-indigo-900 border border-indigo-500" /> 基准位 P</span>
                      <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-emerald-950 border border-emerald-500" /> 3位补位轨</span>
                    </div>

                  </div>

                  {/* Trigger stats and metadata (7 cols) */}
                  <div className="md:col-span-7 flex flex-col gap-3 font-sans text-xs">
                    <div className="bg-slate-950/80 border border-slate-900 p-4 rounded-xl space-y-2 leading-relaxed">
                      <div className="flex justify-between items-center pb-2 border-b border-slate-900">
                        <strong className="text-white">第 {selectedTrigger.period} 期隔期同号事件</strong>
                        <span className={`px-2 py-0.5 rounded font-mono text-[9px] ${
                          selectedTrigger.status === 'Hit' 
                            ? 'bg-emerald-950 border border-emerald-900 text-emerald-400' 
                            : selectedTrigger.status === 'Miss'
                              ? 'bg-rose-955 border border-rose-900 text-rose-400'
                              : 'bg-amber-950 border border-amber-900 text-amber-400'
                        }`}>
                          状态: {selectedTrigger.status === 'Hit' ? '成功补位 (Hit)' : selectedTrigger.status === 'Miss' ? '出界 (Miss)' : '阻截追进中'}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-y-1.5 gap-x-4 text-[11px] font-mono">
                        <span className="text-slate-400">同号位置 (名次)</span>
                        <span className="text-slate-200 text-right">第 {selectedTrigger.position} 名</span>
                        
                        <span className="text-slate-400">目标号 (X)</span>
                        <span className="text-emerald-400 text-right font-bold">{selectedTrigger.targetNumber}</span>
                        
                        <span className="text-slate-400">中间夹心号 (Y)</span>
                        <span className="text-slate-250 text-right">{selectedTrigger.sandwichNumber} (第 {selectedTrigger.period}期前一期)</span>
                        
                        <span className="text-slate-400">基准位判定 (P)</span>
                        <span className="text-indigo-400 text-right font-bold">{selectedTrigger.basePosition} 名</span>
                      </div>

                      {selectedTrigger.status === 'Hit' && (
                        <div className="bg-emerald-950/20 border border-emerald-900/30 p-2 text-[10px] rounded text-emerald-400 font-mono">
                          ✔ 目标号 {selectedTrigger.targetNumber} 在触发后的第 <strong>{selectedTrigger.hitPeriodIndex !== undefined ? selectedTrigger.hitPeriodIndex + 1 : '?'} 期</strong> (第 {selectedTrigger.hitPeriod} 期) 理性重现于第 <strong>{selectedTrigger.hitPosition}</strong> 名，轨迹完美吻合。
                        </div>
                      )}
                    </div>

                    <div className="text-slate-500 text-[10px] italic">
                      提示：可在下方表格中任意点击一行触发事件，此交互图谱将自动标绘该事件的环形跳转和命中轨迹。
                    </div>
                  </div>
                </div>
              )}

              {/* EVENTS TABLE AND EXCLUSIONS TABLE */}
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">

                {/* Left table (Triggers history - 5 cols) */}
                <div className="xl:col-span-6 bg-slate-900/30 border border-slate-900 rounded-2xl p-4">
                  <h4 className="text-xs font-mono font-bold text-slate-300 mb-3 uppercase tracking-wider flex items-center justify-between">
                    <span>轨迹信号档案 (最近50次)</span>
                    <span className="text-[10px] text-slate-500 normal-case font-normal">点击行展示图谱</span>
                  </h4>
                  
                  <div className="overflow-y-auto max-h-96 text-xs text-slate-300">
                    <table className="w-full text-left border-collapse font-mono">
                      <thead>
                        <tr className="border-b border-slate-900 text-slate-500 text-[10px] uppercase">
                          <th className="py-2 px-1">触发期</th>
                          <th className="py-2 px-1">信号名次</th>
                          <th className="py-2 px-1">目标号</th>
                          <th className="py-2 px-1">判定 P</th>
                          <th className="py-2 px-1 text-right">回补结果</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-950/50">
                        {triggers.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="py-4 text-center text-slate-600">无触发事件</td>
                          </tr>
                        ) : (
                          triggers.map((trig, idx) => {
                            const isSelected = selectedTrigger && selectedTrigger.period === trig.period && selectedTrigger.position === trig.position;
                            return (
                              <tr 
                                key={idx}
                                onClick={() => setSelectedTrigger(trig)}
                                className={`hover:bg-slate-900/50 transition cursor-pointer ${
                                  isSelected ? 'bg-indigo-950/20 text-indigo-200 font-semibold border-l-2 border-indigo-500' : ''
                                }`}
                              >
                                <td className="py-2 px-1">n-{trig.period}</td>
                                <td className="py-2 px-1 text-slate-400">第 {trig.position} 名</td>
                                <td className="py-2 px-1 text-emerald-400 font-bold">{trig.targetNumber.toString().padStart(2, '0')}</td>
                                <td className="py-2 px-1 text-indigo-400">{trig.basePosition}</td>
                                <td className="py-2 px-1 text-right">
                                  {trig.status === 'Hit' ? (
                                    <span className="text-[10px] text-emerald-400 bg-emerald-950/30 px-1 rounded">
                                      +{trig.hitPeriodIndex !== undefined ? trig.hitPeriodIndex + 1 : '?'}期 Hit
                                    </span>
                                  ) : trig.status === 'Miss' ? (
                                    <span className="text-[10px] text-rose-400 bg-rose-950/30 px-1 rounded">Miss</span>
                                  ) : (
                                    <span className="text-[10px] text-amber-400 bg-amber-900/30 px-1 rounded animate-pulse">追赶中</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Right table (Exclusions validation - 7 cols) */}
                <div className="xl:col-span-6 bg-slate-900/30 border border-slate-900 rounded-2xl p-4">
                  <h4 className="text-xs font-mono font-bold text-slate-300 mb-3 uppercase tracking-wider">
                    六码不可能出现 历史回演验证 (最近30期)
                  </h4>
                  
                  <div className="overflow-y-auto max-h-96 text-xs text-slate-300">
                    <table className="w-full text-left border-collapse font-sans">
                      <thead>
                        <tr className="border-b border-slate-900 text-slate-500 text-[10px] font-mono uppercase">
                          <th className="py-2 px-2">开奖期</th>
                          <th className="py-2 px-1">实际开奖</th>
                          <th className="py-2 px-1">排除预测</th>
                          <th className="py-2 px-2 text-right">结果校验</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-950/50 font-mono">
                        {predictions.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="py-4 text-center text-slate-600">无回测数据</td>
                          </tr>
                        ) : (
                          [...predictions].reverse().map((pred, idx) => (
                            <tr key={idx} className="hover:bg-slate-900/20 text-xs">
                              <td className="py-2.5 px-2 font-semibold text-slate-300">{pred.period}</td>
                              <td className="py-2.5 px-1 pr-3">
                                <span className="text-[10px] text-slate-400">
                                  {pred.actualNumbers?.slice(0, 6).join(' ')} 
                                  <span className="text-rose-400"> +{pred.actualNumbers?.[6]}</span>
                                </span>
                              </td>
                              <td className="py-2.5 px-1">
                                <span className="text-[10px] text-indigo-300 font-bold">
                                  {pred.predictedNumbers.map(n => n.toString().padStart(2, '0')).join(' ')}
                                </span>
                              </td>
                              <td className="py-2.5 px-2 text-right">
                                {pred.isSuccessful ? (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-sans font-semibold text-emerald-400 bg-emerald-950/30 px-1.5 py-0.5 border border-emerald-900/40 rounded">
                                    <CheckCircle2 className="w-3 h-3" />
                                    <span>全部完美规避</span>
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-sans font-semibold text-rose-400 bg-rose-950/30 px-1.5 py-0.5 border border-rose-900/40 rounded">
                                    <XCircle className="w-3 h-3" />
                                    <span>渗漏了: {pred.hitNumbers?.join(', ')}</span>
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

              </div>

            </div>
          )}

          {/* TAB VIEW 3: HEATMAPS AND OMISSIONS */}
          {activeTab === 'heatmap' && (
            <div className="flex flex-col gap-6">
              
              {/* METRIC TOGGLE BAR */}
              <div className="bg-slate-900/40 border border-slate-900 p-4 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 className="text-xs font-mono font-bold text-white mb-0.5">
                    全 49 个号码数理分布沙盘 (Matrix Dashboard)
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    大样本出现频次和极限制约遗漏波段分布。点击号码可高显示单号指标。
                  </p>
                </div>
                
                {/* Switch Controls */}
                <div className="bg-slate-950 p-1 border border-slate-850 rounded-lg flex self-start sm:self-center">
                  <button
                    onClick={() => setGridMetric('frequency')}
                    className={`px-3 py-1 text-xs font-semibold rounded-md transition cursor-pointer ${
                      gridMetric === 'frequency' 
                        ? 'bg-indigo-600 text-white' 
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    总出现频次 (Heat)
                  </button>
                  <button
                    onClick={() => setGridMetric('omission')}
                    className={`px-3 py-1 text-xs font-semibold rounded-md transition cursor-pointer ${
                      gridMetric === 'omission' 
                        ? 'bg-indigo-600 text-white' 
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    当前期遗漏 (Omission)
                  </button>
                </div>
              </div>

              {/* THE 1 to 49 GRID METRIC CHART */}
              <div className="bg-slate-900/20 border border-slate-900 p-6 rounded-2xl">
                
                {/* Calculate colors dynamically based on stats */}
                <div className="grid grid-cols-5 sm:grid-cols-7 md:grid-cols-10 gap-2.5">
                  {Array.from({ length: 49 }, (_, idx) => {
                    const num = idx + 1;
                    const stat = data.frequencyStats.find(s => s.number === num);
                    if (!stat) return null;

                    // Compute dynamic opacity ranges
                    let val = 0;
                    let colorClass = 'bg-slate-950';
                    let label = '';
                    let isHedged = prediction.activeTargets.some(t => t.number === num);
                    let isPredictedExcluded = prediction.predictedNumbers.includes(num);

                    if (gridMetric === 'frequency') {
                      val = stat.frequency;
                      // Frequencies range roughly from 10 to 30 over 165 draws. Let's make it relative
                      const pct = Math.min(100, Math.max(10, ((val - 5) / 25) * 100));
                      // Indigo variations for frequency
                      if (pct > 80) colorClass = 'bg-indigo-900 border border-indigo-500 text-indigo-200';
                      else if (pct > 55) colorClass = 'bg-indigo-950 border border-indigo-700/60 text-indigo-300';
                      else if (pct > 30) colorClass = 'bg-slate-900 border border-slate-800 text-slate-300';
                      else colorClass = 'bg-slate-950 border border-slate-900 text-slate-500';
                      label = `${val}次`;
                    } else {
                      val = stat.omission;
                      // Omissions range from 0 (latest) to up to 80-90.
                      if (val > 40) colorClass = 'bg-rose-950/70 border border-rose-900 text-rose-300'; // Extreme cold / long omission
                      else if (val > 15) colorClass = 'bg-amber-950/40 border border-amber-900/50 text-amber-350'; // Mid omission
                      else colorClass = 'bg-slate-950 border border-slate-850 text-slate-400'; // Low omission
                      label = `${val}期`;
                    }

                    const isTracked = myTracker?.monitoredNumbers?.includes(num);
                    const canToggle = !!user;

                    return (
                      <div 
                        key={num}
                        onClick={() => canToggle && toggleTrackedNumber(num)}
                        className={`p-2.5 rounded-xl flex flex-col items-center justify-between font-mono relative group h-14 select-none ${colorClass} ${
                          isHedged ? 'ring-2 ring-emerald-500/80 ring-offset-2 ring-offset-slate-950' : ''
                        } ${
                          isPredictedExcluded ? 'ring-2 ring-indigo-500/60 ring-offset-1 ring-offset-slate-950 border-indigo-500' : ''
                        } ${
                          canToggle ? 'cursor-pointer hover:border-indigo-400 hover:scale-105 active:scale-95 transition-all' : 'opacity-90'
                        }`}
                        title={canToggle ? `${num}号: 点击加入/移除我的监控雷达。频率=${stat.frequency}次, 遗漏=${stat.omission}期` : `${num}号: 频率=${stat.frequency}次, 遗漏=${stat.omission}期 (请登录激活实时雷达监控)`}
                      >
                        {/* Upper-right badges */}
                        {isHedged && (
                          <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-emerald-500 border border-slate-950 flex items-center justify-center text-[8px] text-white font-sans font-bold" title="对冲锁定，不可排除">
                            锁
                          </span>
                        )}
                        {isPredictedExcluded && !isHedged && (
                          <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-indigo-500 border border-slate-950 flex items-center justify-center text-[8px] text-white font-sans font-bold" title="排查号码">
                            排
                          </span>
                        )}
                        {/* Upper-left badge for user-specific trackers */}
                        {isTracked && (
                          <span className="absolute -top-1.5 -left-1.5 w-4 h-4 rounded-full bg-rose-500 border border-slate-950 flex items-center justify-center text-[8px] text-white font-sans font-bold shadow animate-pulse" title="已设雷达监视">
                            🎯
                          </span>
                        )}

                        <span className="text-xs font-extrabold">{num.toString().padStart(2, '0')}</span>
                        <span className="text-[8px] text-slate-500 font-normal">{label}</span>
                      </div>
                    );
                  })}
                </div>

                {/* LEGEND SPECIFICATION */}
                <div className="flex gap-4 flex-wrap text-[10px] text-slate-500 font-mono mt-5 border-t border-slate-900 pt-4">
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-indigo-900 border border-indigo-500" /> 高频号码群</span>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-rose-950/70 border border-rose-900" /> 长期遗漏号码 (遗漏超40期)</span>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm ring-2 ring-emerald-500 bg-slate-955" /> 屏蔽对冲保护号</span>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm ring-2 ring-indigo-500 bg-indigo-950/20" /> 下期排除号码 (当前计算最优群)</span>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-rose-500 flex items-center justify-center text-[6px] text-white font-sans font-bold">🎯</span> 我的雷达监控号</span>
                </div>

                <div className="text-[10.5px] text-indigo-400 font-mono mt-3 text-right">
                  {user ? (
                    <span>💡 提示：点击方阵任意号可实时切换 <strong>🎯 个人雷达监控哨</strong>，数据由 Firebase 实施多端同步！</span>
                  ) : (
                    <span className="text-slate-500">💡 提示：Google 快速登录后可任意激活 <strong>🎯 个人雷达监控哨</strong> 以在矩阵中高亮显示关注号码指标。</span>
                  )}
                </div>
              </div>

              {/* LIST BY FREQUENCY RANKS */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs text-slate-300">
                
                {/* 10 Hottest */}
                <div className="bg-slate-900/30 border border-slate-900 p-4 rounded-xl">
                  <h4 className="text-xs font-mono font-bold text-slate-300 mb-3 uppercase flex items-center gap-1">
                    <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                    <span>大样本高频出现热号 TOP 10</span>
                  </h4>
                  <div className="divide-y divide-slate-950/60 font-mono">
                    {sortedStats.slice(0, 10).map((st, i) => (
                      <div key={st.number} className="py-1.5 flex justify-between">
                        <span>第 {i+1} 名: <strong>{st.number.toString().padStart(2, '0')} 号</strong></span>
                        <span className="text-slate-400">出现 {st.frequency} 次 (约 {((st.frequency / data.totalCount) * 100).toFixed(1)}% 概率)</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 10 Coldest */}
                <div className="bg-slate-900/30 border border-slate-900 p-4 rounded-xl">
                  <h4 className="text-xs font-mono font-bold text-slate-300 mb-3 uppercase flex items-center gap-1">
                    <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
                    <span>深度遗漏/冷态极值 TOP 10</span>
                  </h4>
                  <div className="divide-y divide-slate-950/60 font-mono">
                    {[...data.frequencyStats].sort((a,b) => b.omission - a.omission).slice(0, 10).map((st, i) => (
                      <div key={st.number} className="py-1.5 flex justify-between">
                        <span>第 {i+1} 名: <strong>{st.number.toString().padStart(2, '0')} 号</strong></span>
                        <span className="text-rose-400 font-semibold">已遗漏 {st.omission} 期未现身</span>
                      </div>
                    ))}
                  </div>
                </div>

              </div>

            </div>
          )}

        </section>

      </main>

      {/* FOOTER */}
      <footer className="border-t border-slate-900 bg-slate-950 py-6 mt-16 text-center text-xs text-slate-500 font-mono px-4">
        <div className="max-w-7xl mx-auto space-y-2">
          <p>
            MacauJC 赛马轨迹分析客户端. 所有推导逻辑及回测轨迹归档均在服务器端本地计算。
          </p>
          <p className="text-[10px] text-slate-650">
            © 2026 混沌数理概率研究组。本系统仅用作学术算法之研究及概率模型回测，不包含任何商业性推广行为。
          </p>
        </div>
      </footer>

    </div>
  );
}
