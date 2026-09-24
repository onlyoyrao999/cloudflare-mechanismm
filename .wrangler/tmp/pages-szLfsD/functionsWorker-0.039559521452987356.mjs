var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// ../src/data/analyzer.ts
function getCircularPositions(P) {
  if (P === 1) {
    return [1, 2, 7];
  } else if (P === 7) {
    return [6, 7, 1];
  } else {
    return [P - 1, P, P + 1];
  }
}
__name(getCircularPositions, "getCircularPositions");
function analyzeData(rawRecords) {
  const recordsAsc = [...rawRecords].sort((a, b) => a.period.localeCompare(b.period));
  const triggers = [];
  for (let i = 2; i < recordsAsc.length; i++) {
    const N_period = recordsAsc[i];
    const N_minus_2_period = recordsAsc[i - 2];
    const N_minus_1_period = recordsAsc[i - 1];
    for (let k = 0; k < 7; k++) {
      const numX = N_period.numbers[k];
      const numX_prevStatus = N_minus_2_period.numbers[k];
      if (numX !== void 0 && numX === numX_prevStatus) {
        const position = k + 1;
        const sandwichNumber = N_minus_1_period.numbers[k];
        let basePosition = position;
        const yIndexInN = N_period.numbers.indexOf(sandwichNumber);
        if (yIndexInN !== -1) {
          basePosition = yIndexInN + 1;
        } else {
          basePosition = position;
        }
        const trackingWindow = [];
        for (let w = 1; w <= 8; w++) {
          if (i + w < recordsAsc.length) {
            trackingWindow.push(recordsAsc[i + w].period);
          }
        }
        const trigger = {
          period: N_period.period,
          position,
          targetNumber: numX,
          sandwichNumber,
          basePosition,
          trackingWindow,
          status: "In Progress"
        };
        const expectedPositions = getCircularPositions(basePosition);
        let hitFound = false;
        for (let w = 1; w <= 8; w++) {
          const nextIndex = i + w;
          if (nextIndex >= recordsAsc.length) {
            break;
          }
          const nextDraw = recordsAsc[nextIndex];
          for (const posToCheck of expectedPositions) {
            const numAtPos = nextDraw.numbers[posToCheck - 1];
            if (numAtPos === numX) {
              trigger.status = "Hit";
              trigger.hitPeriodIndex = w - 1;
              trigger.hitPeriod = nextDraw.period;
              trigger.hitPosition = posToCheck;
              hitFound = true;
              break;
            }
          }
          if (hitFound) break;
        }
        if (!hitFound) {
          if (i + 8 < recordsAsc.length) {
            trigger.status = "Miss";
          } else {
            trigger.status = "In Progress";
          }
        }
        triggers.push(trigger);
      }
    }
  }
  const frequencyStats = Array.from({ length: 49 }, (_, idx) => {
    const num = idx + 1;
    let freq = 0;
    let omission = 0;
    let lastSeenPeriod = "";
    let foundLastSeen = false;
    for (let r = 0; r < rawRecords.length; r++) {
      const rec = rawRecords[r];
      if (rec.numbers.includes(num)) {
        freq++;
        if (!foundLastSeen) {
          lastSeenPeriod = rec.period;
          omission = r;
          foundLastSeen = true;
        }
      }
    }
    if (!foundLastSeen) {
      omission = rawRecords.length;
    }
    return {
      number: num,
      frequency: freq,
      omission,
      lastSeenPeriod
    };
  });
  const predictions = [];
  const activePredictionsMap = {};
  for (let idx = 20; idx < recordsAsc.length; idx++) {
    const targetPeriod = recordsAsc[idx].period;
    const previousPeriodRecord = recordsAsc[idx - 1];
    const previousPeriod = previousPeriodRecord.period;
    const activeTargetsForPeriod = [];
    const activeWindowStartIdx = Math.max(0, idx - 8);
    for (let wIdx = activeWindowStartIdx; wIdx < idx; wIdx++) {
      const activePeriod = recordsAsc[wIdx].period;
      const periodTriggers = triggers.filter((t) => t.period === activePeriod);
      for (const trig of periodTriggers) {
        let hitBeforeTarget = false;
        if (trig.status === "Hit" && trig.hitPeriod) {
          const hitIdx = recordsAsc.findIndex((r) => r.period === trig.hitPeriod);
          if (hitIdx < idx) {
            hitBeforeTarget = true;
          }
        }
        if (!hitBeforeTarget) {
          activeTargetsForPeriod.push(trig.targetNumber);
        }
      }
    }
    const prevPrediction = activePredictionsMap[previousPeriod] || [];
    const historyBeforeTarget = recordsAsc.slice(Math.max(0, idx - 80), idx);
    const subFreqMap = {};
    const subOmissionMap = {};
    for (let n = 1; n <= 49; n++) {
      subFreqMap[n] = 0;
      let om = 0;
      let found = false;
      for (let h = historyBeforeTarget.length - 1; h >= 0; h--) {
        if (historyBeforeTarget[h].numbers.includes(n)) {
          subFreqMap[n]++;
          if (!found) {
            om = historyBeforeTarget.length - 1 - h;
            found = true;
          }
        }
      }
      if (!found) {
        om = historyBeforeTarget.length;
      }
      subOmissionMap[n] = om;
    }
    const candidateScores = [];
    for (let num = 1; num <= 49; num++) {
      if (activeTargetsForPeriod.includes(num)) continue;
      if (prevPrediction.includes(num)) continue;
      const freq = subFreqMap[num] || 0;
      const omission = subOmissionMap[num] || 0;
      const score = freq * 100 - omission;
      candidateScores.push({ num, score, freq, omission });
    }
    candidateScores.sort((a, b) => a.score - b.score);
    const predictedNumbers = candidateScores.slice(0, 6).map((c) => c.num);
    activePredictionsMap[targetPeriod] = predictedNumbers;
    const actualNumbers = recordsAsc[idx].numbers;
    const hitNumbers = predictedNumbers.filter((n) => actualNumbers.includes(n));
    const isSuccessful = hitNumbers.length === 0;
    predictions.push({
      period: targetPeriod,
      predictedNumbers,
      actualNumbers,
      isSuccessful,
      hitNumbers
    });
  }
  const closedTriggers = triggers.filter((t) => t.status !== "In Progress");
  const totalTriggers = triggers.length;
  const totalInProgress = triggers.filter((t) => t.status === "In Progress").length;
  const totalHits = triggers.filter((t) => t.status === "Hit").length;
  const totalMisses = triggers.filter((t) => t.status === "Miss").length;
  const totalHit1To4 = triggers.filter((t) => t.status === "Hit" && (t.hitPeriodIndex !== void 0 && t.hitPeriodIndex < 4)).length;
  const totalHit5To8 = triggers.filter((t) => t.status === "Hit" && (t.hitPeriodIndex !== void 0 && t.hitPeriodIndex >= 4)).length;
  const overallHitRate = closedTriggers.length > 0 ? totalHits / closedTriggers.length : 0;
  const hitRate1To4 = totalHits > 0 ? totalHit1To4 / totalHits : 0;
  const hitRate5To8 = totalHits > 0 ? totalHit5To8 / totalHits : 0;
  const completedPredictions = predictions.filter((p) => p.actualNumbers !== void 0);
  const totalSuccessfulPredictions = completedPredictions.filter((p) => p.isSuccessful).length;
  const exclusionSuccessRate = completedPredictions.length > 0 ? totalSuccessfulPredictions / completedPredictions.length : 0;
  const summary = {
    totalDraws: rawRecords.length,
    totalTriggers,
    totalHits,
    totalHit1To4,
    totalHit5To8,
    totalMisses,
    totalInProgress,
    overallHitRate,
    hitRate1To4,
    hitRate5To8,
    exclusionSuccessRate
  };
  return {
    recordsAsc,
    triggers,
    frequencyStats,
    predictions,
    summary
  };
}
__name(analyzeData, "analyzeData");
function predictNextDraw(rawRecords, triggers, lastPredictions) {
  const recordsAsc = [...rawRecords].sort((a, b) => a.period.localeCompare(b.period));
  const latestRecord = recordsAsc[recordsAsc.length - 1];
  const lastPeriod = latestRecord.period;
  const lastPeriodNum = parseInt(lastPeriod, 10);
  const nextPeriod = isNaN(lastPeriodNum) ? `${lastPeriod}_next` : (lastPeriodNum + 1).toString();
  const activeTargets = [];
  const limitIdx = recordsAsc.length;
  const last8Draws = recordsAsc.slice(-8);
  for (const draw of last8Draws) {
    const periodTriggers = triggers.filter((t) => t.period === draw.period);
    for (const trig of periodTriggers) {
      let alreadyHit = false;
      if (trig.status === "Hit" && trig.hitPeriod) {
        const hitIdx = recordsAsc.findIndex((r) => r.period === trig.hitPeriod);
        if (hitIdx !== -1 && hitIdx < limitIdx) {
          alreadyHit = true;
        }
      }
      if (!alreadyHit) {
        const drawIdx = recordsAsc.findIndex((r) => r.period === draw.period);
        const elapsed = recordsAsc.length - drawIdx;
        const remaining = 8 - elapsed;
        if (remaining >= 0) {
          activeTargets.push({
            number: trig.targetNumber,
            period: trig.period,
            basePos: trig.basePosition,
            remainingPeriods: remaining + 1
            // include next draw
          });
        }
      }
    }
  }
  const freqMap = {};
  const omissionMap = {};
  for (let n = 1; n <= 49; n++) {
    freqMap[n] = 0;
    let om = 0;
    let found = false;
    for (let h = recordsAsc.length - 1; h >= 0; h--) {
      if (recordsAsc[h].numbers.includes(n)) {
        freqMap[n]++;
        if (!found) {
          om = recordsAsc.length - 1 - h;
          found = true;
        }
      }
    }
    if (!found) {
      om = recordsAsc.length;
    }
    omissionMap[n] = om;
  }
  const activeNumbers = activeTargets.map((t) => t.number);
  const candidates = [];
  for (let num = 1; num <= 49; num++) {
    if (activeNumbers.includes(num)) continue;
    if (lastPredictions.includes(num)) continue;
    const freq = freqMap[num] || 0;
    const omission = omissionMap[num] || 0;
    const score = freq * 100 - omission;
    candidates.push({ num, score, freq, omission });
  }
  candidates.sort((a, b) => a.score - b.score);
  const predictedNumbers = candidates.slice(0, 6).map((c) => c.num).sort((a, b) => a - b);
  const lastTriggerText = activeTargets.length > 0 ? activeTargets.map((t) => `\u7B2C ${t.period} \u671F\u7684\u53F7\u7801 ${t.number} \u5728\u7B2C ${t.basePos} \u4F4D\u89E6\u53D1\uFF0C\u5269\u4F59\u8FFD\u8D76\u5468\u671F ${t.remainingPeriods} \u671F`).join("; ") : "\u8FD1\u671F\u65E0\u5904\u4E8E\u8FFD\u8D76\u5468\u671F\u5185\u7684\u6D3B\u8DC3\u76EE\u6807\u53F7";
  const triggerLocking = `\u901A\u8FC7\u5BF9\u8FD1\u671F\u5F00\u5956\u6570\u636E\u7684\u7EB5\u5411\u6BD4\u5BF9\uFF0C\u672C\u8F6E\u7B97\u6CD5\u805A\u7126\u4E8E\u6355\u6349\u6700\u65B0\u7684\u201C\u9694\u671F\u540C\u53F7\u201D\u73B0\u8C61\u3002\u5F53\u524D\u6A21\u578B\u8BC6\u522B\u5230 ${activeTargets.length > 0 ? `\u6D3B\u8DC3\u7684\u76EE\u6807\u8FFD\u8E2A\u53F7 [${activeNumbers.join(", ")}]` : "\u65E0\u6D3B\u8DC3\u76EE\u6807\u8FFD\u8E2A\u53F7"}\u3002\u901A\u8FC7\u8FFD\u8E2A\u5939\u5FC3\u671F\u7684\u4F4D\u79FB\u8F68\u8FF9\uFF0C\u9501\u5B9A\u6700\u8FD1\u4E00\u671F\u6D3B\u8DC3\u540D\u6B21\u3002${lastTriggerText}\uFF0C\u6211\u4EEC\u5C06\u8FD9\u4E9B\u6838\u5FC3\u53D8\u52A8\u8F68\u8FF9\u8FDB\u884C\u6DF1\u5EA6\u6807\u5B9A\uFF0C\u501F\u800C\u8BA1\u7B97\u57FA\u51C6\u4F4D P\u3002`;
  const edgeDeduction = `\u6211\u6B63\u5728\u6DF1\u5EA6\u89E3\u6790\u8FB9\u7F18\u73AF\u5F62\u8DEF\u5F84\u7B97\u6CD5\u3002\u9488\u5BF9\u9996\u5C3E\u540D\u6B21\uFF08\u7B2C 1 \u540D\u4E0E\u7B2C 7 \u540D\uFF09\u7684\u8FB9\u7F18\u6027\u7279\u5F81\uFF0C\u7CFB\u7EDF\u5DF2\u6267\u884C\u73AF\u5F62\u8DEF\u5F84\u8DF3\u8F6C\u8BA1\u7B97\uFF08\u5982 1 \u540D\u5BF9\u5E94 1\u30012\u30017\uFF0C7 \u540D\u5BF9\u5E94 6\u30017\u30011\uFF09\u3002\u901A\u8FC7\u5BF9 ${activeTargets.length > 0 ? `\u5F53\u524D\u76EE\u6807\u53F7\u7801\u5728\u63A5\u4E0B\u6765\u5468\u671F\u5185\u7684\u8FFD\u8D76\u8DB3\u8FF9\u8FDB\u884C\u7CBE\u786E\u6620\u5C04` : "\u5386\u53F2\u5E38\u6001\u8F68\u8FF9"}\u7684\u6D4B\u7B97\uFF0C\u6211\u4EEC\u5C06\u8FD9 3 \u70B9\u9AD8\u56DE\u8865\u51E0\u7387\u5728\u7A7A\u95F4\u7EF4\u5EA6\u4E0A\u8FDB\u884C\u9501\u5B9A\u3002\u5728\u63A8\u5BFC\u8FC7\u7A0B\u4E2D\uFF0C\u901A\u8FC7\u201C\u5BF9\u51B2\u6CD5\u5219\u201D\uFF0C\u786E\u4FDD\u9884\u6D4B\u8DEF\u5F84\u4E0A\u5206\u5E03\u7684\u9AD8\u6982\u7387\u91CD\u53E0\u53F7\u4E0D\u88AB\u5217\u5165\u6392\u9664\u8303\u56F4\uFF0C\u4ECE\u800C\u7EF4\u6301\u6574\u4F53\u9884\u6D4B\u94FE\u6761\u7684\u4E25\u5BC6\u6027\u3002`;
  const coldShow = candidates.slice(0, 4).map((c) => `${c.num}\u53F7(\u5386\u53F2\u51FA\u73B0${c.freq}\u6B21,\u9057\u6F0F${c.omission}\u671F)`).join("\u3001");
  const omissionConclusion = `\u4E3A\u4E86\u6700\u7EC8\u7CBE\u70BC\u51FA\u90A3 6 \u4E2A\u4E0D\u53EF\u80FD\u51FA\u73B0\u7684\u6781\u4F4E\u6982\u7387\u53F7\u7801\uFF0C\u7CFB\u7EDF\u7ED3\u5408 495 \u671F\u5386\u53F2\u5927\u6570\u636E\uFF0C\u5BF9\u6240\u6709\u53F7\u7801\u7684\u51B7\u70ED\u7CFB\u6570\u4E0E\u9057\u6F0F\u6CE2\u5CF0\u5B9E\u65BD\u4E86\u5168\u5C40\u626B\u63CF\u3002\u8BA1\u7B97\u7ED3\u679C\u663E\u793A\uFF0C\u5982 ${coldShow} \u7B49\u53F7\u7801\u5904\u4E8E\u663E\u8457\u7684\u51B7\u6001\u5931\u8C03\u533A\u95F4\u6216\u957F\u671F\u5904\u4E8E\u9057\u6F0F\u8C37\u503C\u3002\u6211\u4EEC\u5C06\u8FD9\u4E9B\u51B7\u53F7\u7684\u9057\u6F0F\u60EF\u6027\u4E0E\u5F53\u524D\u7684\u73AF\u5F62\u6D3B\u8DC3\u8DEF\u5F84\u8FDB\u884C\u4E8C\u6B21\u5BF9\u51B2\uFF0C\u6210\u529F\u5254\u9664\u9AD8\u5371\u53CD\u5F39\u6570\u503C\u3002\u57FA\u4E8E\u6B64\uFF0C\u6700\u7EC8\u9884\u6D4B\u51FA\u4E0B\u4E00\u671F\u4E0D\u53EF\u80FD\u51FA\u73B0\u76846\u4E2A\u53F7\u7801\u4E3A\uFF1A[${predictedNumbers.map((n) => n.toString().padStart(2, "0")).join(", ")}]\uFF0C\u5DF2\u5373\u523B\u5B8C\u6210\u6570\u636E\u5F52\u6863\u3002`;
  return {
    predictedNumbers,
    activeTargets,
    reasoning: {
      triggerLocking,
      edgeDeduction,
      omissionConclusion
    }
  };
}
__name(predictNextDraw, "predictNextDraw");

// ../src/data/history.json
var history_default = [
  {
    period: "2026267",
    numbers: [
      16,
      20,
      25,
      22,
      9,
      41,
      40
    ]
  },
  {
    period: "2026266",
    numbers: [
      38,
      42,
      37,
      29,
      45,
      18,
      8
    ]
  },
  {
    period: "2026265",
    numbers: [
      5,
      46,
      40,
      23,
      26,
      44,
      49
    ]
  },
  {
    period: "2026264",
    numbers: [
      10,
      6,
      8,
      31,
      22,
      24,
      21
    ]
  },
  {
    period: "2026263",
    numbers: [
      44,
      28,
      3,
      2,
      24,
      13,
      9
    ]
  },
  {
    period: "2026262",
    numbers: [
      38,
      22,
      33,
      47,
      36,
      7,
      30
    ]
  },
  {
    period: "2026261",
    numbers: [
      6,
      25,
      43,
      46,
      29,
      47,
      24
    ]
  },
  {
    period: "2026260",
    numbers: [
      25,
      26,
      44,
      32,
      6,
      48,
      20
    ]
  },
  {
    period: "2026259",
    numbers: [
      43,
      33,
      49,
      36,
      19,
      30,
      22
    ]
  },
  {
    period: "2026258",
    numbers: [
      3,
      23,
      21,
      35,
      5,
      19,
      46
    ]
  },
  {
    period: "2026257",
    numbers: [
      8,
      46,
      47,
      39,
      27,
      45,
      7
    ]
  },
  {
    period: "2026256",
    numbers: [
      40,
      15,
      9,
      37,
      7,
      3,
      1
    ]
  },
  {
    period: "2026255",
    numbers: [
      36,
      22,
      6,
      47,
      39,
      11,
      44
    ]
  },
  {
    period: "2026254",
    numbers: [
      26,
      44,
      35,
      6,
      16,
      10,
      2
    ]
  },
  {
    period: "2026253",
    numbers: [
      5,
      35,
      15,
      28,
      13,
      49,
      16
    ]
  },
  {
    period: "2026252",
    numbers: [
      33,
      41,
      43,
      13,
      6,
      48,
      22
    ]
  },
  {
    period: "2026251",
    numbers: [
      9,
      6,
      11,
      25,
      8,
      45,
      30
    ]
  },
  {
    period: "2026250",
    numbers: [
      10,
      6,
      39,
      47,
      37,
      17,
      14
    ]
  },
  {
    period: "2026249",
    numbers: [
      41,
      22,
      13,
      36,
      26,
      29,
      23
    ]
  },
  {
    period: "2026248",
    numbers: [
      43,
      26,
      49,
      39,
      14,
      27,
      20
    ]
  },
  {
    period: "2026247",
    numbers: [
      3,
      9,
      43,
      29,
      46,
      4,
      40
    ]
  },
  {
    period: "2026246",
    numbers: [
      22,
      24,
      19,
      10,
      20,
      1,
      30
    ]
  },
  {
    period: "2026245",
    numbers: [
      22,
      23,
      14,
      2,
      13,
      38,
      18
    ]
  },
  {
    period: "2026244",
    numbers: [
      9,
      14,
      3,
      17,
      33,
      40,
      46
    ]
  },
  {
    period: "2026243",
    numbers: [
      42,
      17,
      12,
      46,
      9,
      24,
      21
    ]
  },
  {
    period: "2026242",
    numbers: [
      29,
      35,
      46,
      32,
      13,
      31,
      9
    ]
  },
  {
    period: "2026241",
    numbers: [
      29,
      45,
      27,
      21,
      42,
      41,
      49
    ]
  },
  {
    period: "2026240",
    numbers: [
      2,
      34,
      22,
      26,
      28,
      37,
      27
    ]
  },
  {
    period: "2026239",
    numbers: [
      47,
      43,
      34,
      17,
      22,
      7,
      5
    ]
  },
  {
    period: "2026238",
    numbers: [
      35,
      44,
      23,
      4,
      7,
      21,
      17
    ]
  },
  {
    period: "2026237",
    numbers: [
      47,
      36,
      14,
      6,
      41,
      25,
      12
    ]
  },
  {
    period: "2026236",
    numbers: [
      26,
      35,
      42,
      9,
      14,
      17,
      11
    ]
  },
  {
    period: "2026235",
    numbers: [
      27,
      26,
      35,
      17,
      44,
      21,
      32
    ]
  },
  {
    period: "2026234",
    numbers: [
      25,
      30,
      37,
      19,
      7,
      17,
      39
    ]
  },
  {
    period: "2026233",
    numbers: [
      18,
      41,
      5,
      49,
      4,
      34,
      7
    ]
  },
  {
    period: "2026232",
    numbers: [
      29,
      10,
      17,
      4,
      46,
      20,
      42
    ]
  },
  {
    period: "2026231",
    numbers: [
      39,
      46,
      23,
      11,
      8,
      13,
      20
    ]
  },
  {
    period: "2026230",
    numbers: [
      28,
      26,
      47,
      14,
      49,
      10,
      16
    ]
  },
  {
    period: "2026229",
    numbers: [
      11,
      7,
      15,
      13,
      33,
      16,
      38
    ]
  },
  {
    period: "2026228",
    numbers: [
      38,
      26,
      8,
      6,
      29,
      18,
      23
    ]
  },
  {
    period: "2026227",
    numbers: [
      23,
      24,
      29,
      7,
      13,
      31,
      16
    ]
  },
  {
    period: "2026226",
    numbers: [
      1,
      11,
      29,
      38,
      4,
      33,
      17
    ]
  },
  {
    period: "2026225",
    numbers: [
      7,
      34,
      27,
      10,
      19,
      38,
      1
    ]
  },
  {
    period: "2026224",
    numbers: [
      25,
      19,
      8,
      49,
      18,
      36,
      9
    ]
  },
  {
    period: "2026223",
    numbers: [
      21,
      43,
      1,
      38,
      29,
      44,
      23
    ]
  },
  {
    period: "2026222",
    numbers: [
      49,
      14,
      47,
      27,
      18,
      38,
      26
    ]
  },
  {
    period: "2026221",
    numbers: [
      24,
      14,
      18,
      48,
      46,
      28,
      1
    ]
  },
  {
    period: "2026220",
    numbers: [
      27,
      39,
      4,
      12,
      38,
      25,
      48
    ]
  },
  {
    period: "2026219",
    numbers: [
      31,
      41,
      7,
      8,
      29,
      22,
      43
    ]
  },
  {
    period: "2026218",
    numbers: [
      2,
      13,
      47,
      38,
      46,
      23,
      17
    ]
  },
  {
    period: "2026217",
    numbers: [
      34,
      12,
      11,
      30,
      42,
      7,
      26
    ]
  },
  {
    period: "2026216",
    numbers: [
      18,
      41,
      32,
      44,
      36,
      45,
      37
    ]
  },
  {
    period: "2026215",
    numbers: [
      19,
      38,
      30,
      13,
      1,
      11,
      14
    ]
  },
  {
    period: "2026214",
    numbers: [
      29,
      30,
      27,
      38,
      43,
      31,
      4
    ]
  },
  {
    period: "2026213",
    numbers: [
      9,
      5,
      12,
      22,
      1,
      15,
      35
    ]
  },
  {
    period: "2026212",
    numbers: [
      43,
      32,
      16,
      39,
      19,
      27,
      6
    ]
  },
  {
    period: "2026211",
    numbers: [
      13,
      12,
      39,
      37,
      38,
      8,
      1
    ]
  },
  {
    period: "2026210",
    numbers: [
      40,
      37,
      15,
      17,
      42,
      48,
      49
    ]
  },
  {
    period: "2026209",
    numbers: [
      44,
      5,
      39,
      14,
      21,
      22,
      8
    ]
  },
  {
    period: "2026208",
    numbers: [
      7,
      48,
      40,
      35,
      23,
      28,
      19
    ]
  },
  {
    period: "2026207",
    numbers: [
      9,
      40,
      26,
      23,
      44,
      13,
      31
    ]
  },
  {
    period: "2026206",
    numbers: [
      9,
      49,
      37,
      3,
      40,
      35,
      47
    ]
  },
  {
    period: "2026205",
    numbers: [
      30,
      17,
      39,
      12,
      11,
      28,
      3
    ]
  },
  {
    period: "2026204",
    numbers: [
      11,
      12,
      17,
      26,
      10,
      7,
      5
    ]
  },
  {
    period: "2026203",
    numbers: [
      12,
      11,
      31,
      3,
      44,
      37,
      25
    ]
  },
  {
    period: "2026202",
    numbers: [
      21,
      15,
      25,
      47,
      13,
      45,
      40
    ]
  },
  {
    period: "2026201",
    numbers: [
      46,
      28,
      19,
      38,
      31,
      25,
      32
    ]
  },
  {
    period: "2026200",
    numbers: [
      43,
      46,
      5,
      32,
      35,
      29,
      39
    ]
  },
  {
    period: "2026199",
    numbers: [
      17,
      49,
      42,
      45,
      5,
      38,
      36
    ]
  },
  {
    period: "2026198",
    numbers: [
      48,
      35,
      45,
      21,
      12,
      24,
      7
    ]
  },
  {
    period: "2026197",
    numbers: [
      40,
      19,
      30,
      48,
      44,
      28,
      8
    ]
  },
  {
    period: "2026196",
    numbers: [
      3,
      37,
      24,
      10,
      41,
      19,
      39
    ]
  },
  {
    period: "2026195",
    numbers: [
      46,
      23,
      39,
      4,
      9,
      19,
      25
    ]
  },
  {
    period: "2026194",
    numbers: [
      30,
      21,
      22,
      15,
      4,
      34,
      26
    ]
  },
  {
    period: "2026193",
    numbers: [
      2,
      49,
      25,
      11,
      45,
      29,
      9
    ]
  },
  {
    period: "2026192",
    numbers: [
      27,
      30,
      45,
      8,
      1,
      37,
      25
    ]
  },
  {
    period: "2026191",
    numbers: [
      19,
      43,
      39,
      24,
      16,
      26,
      29
    ]
  },
  {
    period: "2026190",
    numbers: [
      46,
      14,
      19,
      37,
      48,
      29,
      16
    ]
  },
  {
    period: "2026189",
    numbers: [
      45,
      12,
      37,
      20,
      38,
      43,
      15
    ]
  },
  {
    period: "2026188",
    numbers: [
      38,
      5,
      19,
      10,
      14,
      1,
      16
    ]
  },
  {
    period: "2026187",
    numbers: [
      23,
      12,
      36,
      38,
      27,
      22,
      1
    ]
  },
  {
    period: "2026186",
    numbers: [
      17,
      29,
      22,
      1,
      5,
      38,
      23
    ]
  },
  {
    period: "2026185",
    numbers: [
      18,
      35,
      9,
      41,
      12,
      30,
      36
    ]
  },
  {
    period: "2026184",
    numbers: [
      44,
      24,
      11,
      36,
      25,
      20,
      1
    ]
  },
  {
    period: "2026183",
    numbers: [
      23,
      9,
      46,
      37,
      42,
      3,
      24
    ]
  },
  {
    period: "2026182",
    numbers: [
      15,
      23,
      9,
      45,
      24,
      39,
      41
    ]
  },
  {
    period: "2026181",
    numbers: [
      17,
      29,
      6,
      34,
      47,
      15,
      19
    ]
  },
  {
    period: "2026180",
    numbers: [
      14,
      10,
      37,
      30,
      49,
      19,
      21
    ]
  },
  {
    period: "2026179",
    numbers: [
      10,
      11,
      26,
      6,
      31,
      9,
      15
    ]
  },
  {
    period: "2026178",
    numbers: [
      26,
      46,
      22,
      44,
      31,
      17,
      18
    ]
  },
  {
    period: "2026177",
    numbers: [
      19,
      21,
      5,
      1,
      2,
      44,
      14
    ]
  },
  {
    period: "2026176",
    numbers: [
      30,
      31,
      2,
      36,
      38,
      15,
      10
    ]
  },
  {
    period: "2026175",
    numbers: [
      7,
      19,
      30,
      29,
      28,
      25,
      26
    ]
  },
  {
    period: "2026174",
    numbers: [
      15,
      8,
      34,
      13,
      28,
      21,
      41
    ]
  },
  {
    period: "2026173",
    numbers: [
      39,
      6,
      16,
      40,
      13,
      19,
      26
    ]
  },
  {
    period: "2026172",
    numbers: [
      28,
      34,
      42,
      37,
      45,
      8,
      44
    ]
  },
  {
    period: "2026171",
    numbers: [
      24,
      38,
      40,
      31,
      42,
      46,
      28
    ]
  },
  {
    period: "2026170",
    numbers: [
      27,
      46,
      6,
      38,
      20,
      34,
      3
    ]
  },
  {
    period: "2026169",
    numbers: [
      44,
      37,
      30,
      8,
      40,
      22,
      24
    ]
  },
  {
    period: "2026168",
    numbers: [
      27,
      11,
      24,
      5,
      40,
      33,
      15
    ]
  },
  {
    period: "2026167",
    numbers: [
      23,
      3,
      40,
      39,
      7,
      11,
      19
    ]
  },
  {
    period: "2026166",
    numbers: [
      20,
      15,
      1,
      4,
      21,
      28,
      6
    ]
  },
  {
    period: "2026165",
    numbers: [
      11,
      47,
      9,
      49,
      2,
      1,
      3
    ]
  },
  {
    period: "2026164",
    numbers: [
      46,
      4,
      38,
      12,
      3,
      2,
      21
    ]
  },
  {
    period: "2026163",
    numbers: [
      39,
      8,
      10,
      33,
      7,
      41,
      37
    ]
  },
  {
    period: "2026162",
    numbers: [
      23,
      41,
      24,
      26,
      33,
      7,
      32
    ]
  },
  {
    period: "2026161",
    numbers: [
      36,
      40,
      42,
      19,
      34,
      46,
      8
    ]
  },
  {
    period: "2026160",
    numbers: [
      8,
      16,
      26,
      1,
      29,
      30,
      2
    ]
  },
  {
    period: "2026159",
    numbers: [
      12,
      4,
      28,
      17,
      20,
      46,
      39
    ]
  },
  {
    period: "2026158",
    numbers: [
      43,
      48,
      3,
      1,
      12,
      23,
      16
    ]
  },
  {
    period: "2026157",
    numbers: [
      43,
      25,
      11,
      31,
      17,
      10,
      40
    ]
  },
  {
    period: "2026156",
    numbers: [
      31,
      16,
      11,
      3,
      37,
      12,
      1
    ]
  },
  {
    period: "2026155",
    numbers: [
      21,
      37,
      46,
      13,
      40,
      47,
      7
    ]
  },
  {
    period: "2026154",
    numbers: [
      46,
      28,
      42,
      31,
      23,
      34,
      41
    ]
  },
  {
    period: "2026153",
    numbers: [
      1,
      38,
      33,
      28,
      6,
      40,
      41
    ]
  },
  {
    period: "2026152",
    numbers: [
      34,
      47,
      16,
      36,
      44,
      1,
      45
    ]
  },
  {
    period: "2026151",
    numbers: [
      27,
      15,
      29,
      42,
      20,
      41,
      31
    ]
  },
  {
    period: "2026150",
    numbers: [
      11,
      4,
      22,
      25,
      44,
      19,
      9
    ]
  },
  {
    period: "2026149",
    numbers: [
      28,
      30,
      44,
      45,
      4,
      20,
      27
    ]
  },
  {
    period: "2026148",
    numbers: [
      28,
      24,
      31,
      23,
      4,
      27,
      48
    ]
  },
  {
    period: "2026147",
    numbers: [
      29,
      40,
      6,
      18,
      31,
      10,
      13
    ]
  },
  {
    period: "2026146",
    numbers: [
      11,
      30,
      20,
      19,
      5,
      16,
      42
    ]
  },
  {
    period: "2026145",
    numbers: [
      36,
      43,
      25,
      32,
      37,
      18,
      5
    ]
  },
  {
    period: "2026144",
    numbers: [
      47,
      31,
      29,
      33,
      22,
      26,
      43
    ]
  },
  {
    period: "2026143",
    numbers: [
      13,
      26,
      18,
      32,
      2,
      33,
      44
    ]
  },
  {
    period: "2026142",
    numbers: [
      45,
      15,
      26,
      21,
      18,
      35,
      23
    ]
  },
  {
    period: "2026141",
    numbers: [
      43,
      8,
      17,
      2,
      34,
      32,
      33
    ]
  },
  {
    period: "2026140",
    numbers: [
      13,
      10,
      42,
      4,
      46,
      34,
      16
    ]
  },
  {
    period: "2026139",
    numbers: [
      41,
      45,
      48,
      1,
      36,
      30,
      24
    ]
  },
  {
    period: "2026138",
    numbers: [
      38,
      22,
      6,
      24,
      20,
      46,
      49
    ]
  },
  {
    period: "2026137",
    numbers: [
      24,
      20,
      32,
      5,
      19,
      7,
      26
    ]
  },
  {
    period: "2026136",
    numbers: [
      1,
      14,
      24,
      17,
      15,
      12,
      48
    ]
  },
  {
    period: "2026135",
    numbers: [
      8,
      35,
      9,
      20,
      18,
      47,
      30
    ]
  },
  {
    period: "2026134",
    numbers: [
      24,
      46,
      40,
      44,
      22,
      49,
      37
    ]
  },
  {
    period: "2026133",
    numbers: [
      38,
      14,
      23,
      1,
      26,
      44,
      7
    ]
  },
  {
    period: "2026132",
    numbers: [
      48,
      11,
      20,
      44,
      39,
      35,
      30
    ]
  },
  {
    period: "2026131",
    numbers: [
      12,
      40,
      21,
      32,
      1,
      25,
      7
    ]
  },
  {
    period: "2026130",
    numbers: [
      41,
      26,
      9,
      11,
      5,
      25,
      29
    ]
  },
  {
    period: "2026129",
    numbers: [
      34,
      7,
      40,
      21,
      17,
      25,
      41
    ]
  },
  {
    period: "2026128",
    numbers: [
      25,
      46,
      2,
      7,
      45,
      42,
      37
    ]
  },
  {
    period: "2026127",
    numbers: [
      14,
      8,
      27,
      3,
      7,
      29,
      45
    ]
  },
  {
    period: "2026126",
    numbers: [
      15,
      9,
      5,
      3,
      1,
      10,
      49
    ]
  },
  {
    period: "2026125",
    numbers: [
      16,
      19,
      7,
      30,
      38,
      39,
      31
    ]
  },
  {
    period: "2026124",
    numbers: [
      46,
      5,
      10,
      17,
      12,
      22,
      39
    ]
  },
  {
    period: "2026123",
    numbers: [
      39,
      23,
      49,
      17,
      42,
      44,
      46
    ]
  },
  {
    period: "2026122",
    numbers: [
      18,
      23,
      15,
      22,
      25,
      45,
      1
    ]
  },
  {
    period: "2026121",
    numbers: [
      45,
      21,
      35,
      48,
      6,
      20,
      44
    ]
  },
  {
    period: "2026120",
    numbers: [
      18,
      24,
      7,
      23,
      48,
      20,
      6
    ]
  },
  {
    period: "2026119",
    numbers: [
      38,
      18,
      32,
      22,
      30,
      40,
      11
    ]
  },
  {
    period: "2026118",
    numbers: [
      38,
      37,
      22,
      46,
      49,
      40,
      8
    ]
  },
  {
    period: "2026117",
    numbers: [
      45,
      2,
      46,
      33,
      19,
      7,
      16
    ]
  },
  {
    period: "2026116",
    numbers: [
      15,
      46,
      16,
      10,
      48,
      33,
      22
    ]
  },
  {
    period: "2026115",
    numbers: [
      21,
      16,
      25,
      29,
      8,
      7,
      4
    ]
  },
  {
    period: "2026114",
    numbers: [
      45,
      41,
      10,
      1,
      36,
      25,
      30
    ]
  },
  {
    period: "2026113",
    numbers: [
      42,
      22,
      15,
      17,
      32,
      49,
      2
    ]
  },
  {
    period: "2026112",
    numbers: [
      15,
      19,
      30,
      7,
      44,
      10,
      9
    ]
  },
  {
    period: "2026111",
    numbers: [
      24,
      23,
      21,
      41,
      38,
      33,
      1
    ]
  },
  {
    period: "2026110",
    numbers: [
      40,
      3,
      43,
      29,
      45,
      19,
      30
    ]
  },
  {
    period: "2026109",
    numbers: [
      38,
      7,
      19,
      24,
      43,
      8,
      16
    ]
  },
  {
    period: "2026108",
    numbers: [
      6,
      30,
      26,
      14,
      48,
      40,
      45
    ]
  },
  {
    period: "2026107",
    numbers: [
      35,
      10,
      41,
      43,
      34,
      6,
      49
    ]
  },
  {
    period: "2026106",
    numbers: [
      31,
      48,
      5,
      11,
      46,
      40,
      22
    ]
  },
  {
    period: "2026105",
    numbers: [
      32,
      44,
      17,
      19,
      11,
      36,
      28
    ]
  },
  {
    period: "2026104",
    numbers: [
      20,
      45,
      39,
      49,
      3,
      48,
      1
    ]
  },
  {
    period: "2026103",
    numbers: [
      34,
      3,
      1,
      30,
      39,
      4,
      6
    ]
  },
  {
    period: "2026102",
    numbers: [
      47,
      3,
      32,
      46,
      39,
      36,
      20
    ]
  },
  {
    period: "2026101",
    numbers: [
      22,
      8,
      2,
      34,
      20,
      12,
      39
    ]
  },
  {
    period: "2026100",
    numbers: [
      24,
      45,
      4,
      32,
      3,
      48,
      33
    ]
  },
  {
    period: "2026099",
    numbers: [
      10,
      32,
      22,
      18,
      28,
      17,
      12
    ]
  },
  {
    period: "2026098",
    numbers: [
      24,
      8,
      3,
      14,
      32,
      49,
      17
    ]
  },
  {
    period: "2026097",
    numbers: [
      28,
      8,
      44,
      26,
      29,
      46,
      11
    ]
  },
  {
    period: "2026096",
    numbers: [
      35,
      37,
      26,
      5,
      25,
      15,
      43
    ]
  },
  {
    period: "2026095",
    numbers: [
      15,
      39,
      1,
      38,
      21,
      48,
      35
    ]
  },
  {
    period: "2026094",
    numbers: [
      16,
      25,
      4,
      28,
      43,
      38,
      17
    ]
  },
  {
    period: "2026093",
    numbers: [
      13,
      18,
      26,
      47,
      48,
      4,
      40
    ]
  },
  {
    period: "2026092",
    numbers: [
      46,
      42,
      25,
      47,
      38,
      19,
      6
    ]
  },
  {
    period: "2026091",
    numbers: [
      8,
      17,
      32,
      5,
      42,
      24,
      37
    ]
  },
  {
    period: "2026090",
    numbers: [
      48,
      29,
      20,
      17,
      37,
      8,
      36
    ]
  },
  {
    period: "2026089",
    numbers: [
      26,
      44,
      34,
      5,
      21,
      22,
      49
    ]
  },
  {
    period: "2026088",
    numbers: [
      16,
      46,
      18,
      10,
      12,
      42,
      27
    ]
  },
  {
    period: "2026087",
    numbers: [
      17,
      1,
      21,
      29,
      47,
      2,
      26
    ]
  },
  {
    period: "2026086",
    numbers: [
      15,
      36,
      14,
      24,
      26,
      34,
      12
    ]
  },
  {
    period: "2026085",
    numbers: [
      14,
      13,
      27,
      33,
      6,
      20,
      19
    ]
  },
  {
    period: "2026084",
    numbers: [
      7,
      24,
      2,
      5,
      20,
      31,
      16
    ]
  },
  {
    period: "2026083",
    numbers: [
      46,
      8,
      23,
      36,
      30,
      1,
      5
    ]
  },
  {
    period: "2026082",
    numbers: [
      3,
      21,
      33,
      37,
      41,
      25,
      27
    ]
  },
  {
    period: "2026081",
    numbers: [
      4,
      36,
      14,
      15,
      35,
      41,
      17
    ]
  },
  {
    period: "2026080",
    numbers: [
      21,
      18,
      17,
      48,
      9,
      42,
      3
    ]
  },
  {
    period: "2026079",
    numbers: [
      49,
      34,
      6,
      20,
      4,
      43,
      35
    ]
  },
  {
    period: "2026078",
    numbers: [
      18,
      17,
      10,
      33,
      2,
      8,
      46
    ]
  },
  {
    period: "2026077",
    numbers: [
      37,
      32,
      46,
      25,
      39,
      30,
      29
    ]
  },
  {
    period: "2026076",
    numbers: [
      12,
      7,
      24,
      22,
      3,
      41,
      2
    ]
  },
  {
    period: "2026075",
    numbers: [
      19,
      22,
      26,
      20,
      41,
      27,
      33
    ]
  },
  {
    period: "2026074",
    numbers: [
      12,
      31,
      49,
      25,
      24,
      32,
      10
    ]
  },
  {
    period: "2026073",
    numbers: [
      7,
      29,
      1,
      33,
      36,
      14,
      34
    ]
  },
  {
    period: "2026072",
    numbers: [
      12,
      28,
      1,
      42,
      25,
      44,
      46
    ]
  },
  {
    period: "2026071",
    numbers: [
      44,
      30,
      25,
      5,
      41,
      8,
      48
    ]
  },
  {
    period: "2026070",
    numbers: [
      47,
      17,
      23,
      10,
      41,
      7,
      25
    ]
  },
  {
    period: "2026069",
    numbers: [
      23,
      16,
      10,
      34,
      8,
      36,
      24
    ]
  },
  {
    period: "2026068",
    numbers: [
      49,
      2,
      1,
      26,
      38,
      21,
      23
    ]
  },
  {
    period: "2026067",
    numbers: [
      15,
      30,
      6,
      1,
      26,
      9,
      5
    ]
  },
  {
    period: "2026066",
    numbers: [
      24,
      20,
      36,
      44,
      2,
      28,
      37
    ]
  },
  {
    period: "2026065",
    numbers: [
      2,
      45,
      17,
      38,
      33,
      24,
      5
    ]
  },
  {
    period: "2026064",
    numbers: [
      8,
      23,
      40,
      44,
      34,
      2,
      18
    ]
  },
  {
    period: "2026063",
    numbers: [
      36,
      26,
      37,
      2,
      44,
      31,
      28
    ]
  },
  {
    period: "2026062",
    numbers: [
      46,
      29,
      6,
      49,
      35,
      42,
      24
    ]
  },
  {
    period: "2026061",
    numbers: [
      46,
      17,
      8,
      25,
      2,
      37,
      29
    ]
  },
  {
    period: "2026060",
    numbers: [
      5,
      27,
      40,
      34,
      39,
      1,
      9
    ]
  },
  {
    period: "2026059",
    numbers: [
      29,
      19,
      24,
      43,
      28,
      12,
      10
    ]
  },
  {
    period: "2026058",
    numbers: [
      20,
      38,
      13,
      21,
      33,
      40,
      31
    ]
  },
  {
    period: "2026057",
    numbers: [
      21,
      29,
      40,
      30,
      26,
      34,
      23
    ]
  },
  {
    period: "2026056",
    numbers: [
      45,
      9,
      6,
      7,
      10,
      26,
      48
    ]
  },
  {
    period: "2026055",
    numbers: [
      31,
      28,
      20,
      21,
      39,
      9,
      14
    ]
  },
  {
    period: "2026054",
    numbers: [
      37,
      30,
      11,
      19,
      49,
      32,
      48
    ]
  },
  {
    period: "2026053",
    numbers: [
      16,
      12,
      33,
      17,
      41,
      18,
      15
    ]
  },
  {
    period: "2026052",
    numbers: [
      15,
      46,
      14,
      13,
      40,
      35,
      38
    ]
  },
  {
    period: "2026051",
    numbers: [
      40,
      42,
      44,
      6,
      14,
      38,
      1
    ]
  },
  {
    period: "2026050",
    numbers: [
      10,
      13,
      30,
      37,
      33,
      44,
      23
    ]
  },
  {
    period: "2026049",
    numbers: [
      28,
      42,
      22,
      49,
      12,
      31,
      13
    ]
  },
  {
    period: "2026048",
    numbers: [
      8,
      38,
      29,
      32,
      46,
      16,
      24
    ]
  },
  {
    period: "2026047",
    numbers: [
      40,
      35,
      23,
      42,
      46,
      47,
      39
    ]
  },
  {
    period: "2026046",
    numbers: [
      13,
      9,
      20,
      22,
      39,
      36,
      3
    ]
  },
  {
    period: "2026045",
    numbers: [
      20,
      38,
      22,
      13,
      42,
      27,
      1
    ]
  },
  {
    period: "2026044",
    numbers: [
      46,
      17,
      39,
      47,
      48,
      38,
      19
    ]
  },
  {
    period: "2026043",
    numbers: [
      9,
      35,
      42,
      40,
      33,
      3,
      13
    ]
  },
  {
    period: "2026042",
    numbers: [
      38,
      22,
      17,
      19,
      1,
      18,
      16
    ]
  },
  {
    period: "2026041",
    numbers: [
      2,
      8,
      17,
      44,
      32,
      27,
      36
    ]
  },
  {
    period: "2026040",
    numbers: [
      46,
      6,
      29,
      27,
      11,
      49,
      28
    ]
  },
  {
    period: "2026039",
    numbers: [
      31,
      20,
      8,
      29,
      10,
      4,
      11
    ]
  },
  {
    period: "2026038",
    numbers: [
      6,
      40,
      49,
      34,
      12,
      20,
      42
    ]
  },
  {
    period: "2026037",
    numbers: [
      34,
      42,
      39,
      13,
      44,
      45,
      43
    ]
  },
  {
    period: "2026036",
    numbers: [
      44,
      39,
      11,
      20,
      27,
      48,
      1
    ]
  },
  {
    period: "2026035",
    numbers: [
      32,
      47,
      44,
      36,
      19,
      41,
      27
    ]
  },
  {
    period: "2026034",
    numbers: [
      38,
      45,
      35,
      24,
      30,
      23,
      19
    ]
  },
  {
    period: "2026033",
    numbers: [
      14,
      22,
      46,
      33,
      8,
      11,
      41
    ]
  },
  {
    period: "2026032",
    numbers: [
      23,
      17,
      11,
      20,
      10,
      39,
      6
    ]
  },
  {
    period: "2026031",
    numbers: [
      38,
      25,
      7,
      19,
      11,
      5,
      26
    ]
  },
  {
    period: "2026030",
    numbers: [
      3,
      6,
      47,
      1,
      35,
      4,
      41
    ]
  },
  {
    period: "2026029",
    numbers: [
      47,
      8,
      5,
      4,
      3,
      18,
      1
    ]
  },
  {
    period: "2026028",
    numbers: [
      17,
      47,
      28,
      39,
      32,
      49,
      3
    ]
  },
  {
    period: "2026027",
    numbers: [
      11,
      16,
      46,
      10,
      18,
      49,
      45
    ]
  },
  {
    period: "2026026",
    numbers: [
      44,
      34,
      24,
      13,
      37,
      42,
      19
    ]
  },
  {
    period: "2026025",
    numbers: [
      46,
      10,
      41,
      6,
      9,
      14,
      37
    ]
  },
  {
    period: "2026024",
    numbers: [
      10,
      45,
      25,
      15,
      23,
      44,
      28
    ]
  },
  {
    period: "2026023",
    numbers: [
      6,
      29,
      36,
      38,
      18,
      31,
      47
    ]
  },
  {
    period: "2026022",
    numbers: [
      39,
      8,
      20,
      37,
      46,
      30,
      18
    ]
  },
  {
    period: "2026021",
    numbers: [
      47,
      45,
      33,
      7,
      24,
      10,
      42
    ]
  },
  {
    period: "2026020",
    numbers: [
      9,
      37,
      14,
      47,
      11,
      24,
      12
    ]
  },
  {
    period: "2026019",
    numbers: [
      42,
      22,
      45,
      19,
      7,
      25,
      46
    ]
  },
  {
    period: "2026018",
    numbers: [
      40,
      42,
      43,
      31,
      25,
      15,
      39
    ]
  },
  {
    period: "2026017",
    numbers: [
      44,
      18,
      31,
      41,
      33,
      2,
      32
    ]
  },
  {
    period: "2026016",
    numbers: [
      34,
      12,
      48,
      26,
      40,
      38,
      6
    ]
  },
  {
    period: "2026015",
    numbers: [
      10,
      8,
      30,
      20,
      15,
      33,
      31
    ]
  },
  {
    period: "2026014",
    numbers: [
      38,
      13,
      12,
      8,
      43,
      31,
      26
    ]
  },
  {
    period: "2026013",
    numbers: [
      9,
      19,
      44,
      27,
      37,
      6,
      1
    ]
  },
  {
    period: "2026012",
    numbers: [
      25,
      26,
      33,
      20,
      41,
      45,
      11
    ]
  },
  {
    period: "2026011",
    numbers: [
      32,
      10,
      7,
      5,
      48,
      15,
      11
    ]
  },
  {
    period: "2026010",
    numbers: [
      23,
      38,
      24,
      49,
      11,
      30,
      27
    ]
  },
  {
    period: "2026009",
    numbers: [
      17,
      18,
      6,
      49,
      7,
      22,
      28
    ]
  },
  {
    period: "2026008",
    numbers: [
      5,
      39,
      36,
      19,
      29,
      45,
      21
    ]
  },
  {
    period: "2026007",
    numbers: [
      28,
      40,
      45,
      34,
      44,
      15,
      41
    ]
  },
  {
    period: "2026006",
    numbers: [
      35,
      41,
      15,
      6,
      46,
      21,
      13
    ]
  },
  {
    period: "2026005",
    numbers: [
      46,
      19,
      20,
      36,
      13,
      17,
      43
    ]
  },
  {
    period: "2026004",
    numbers: [
      22,
      19,
      7,
      35,
      49,
      36,
      45
    ]
  },
  {
    period: "2026003",
    numbers: [
      30,
      44,
      7,
      15,
      42,
      17,
      9
    ]
  },
  {
    period: "2026002",
    numbers: [
      48,
      7,
      4,
      3,
      15,
      11,
      22
    ]
  },
  {
    period: "2026001",
    numbers: [
      27,
      8,
      43,
      33,
      42,
      11,
      29
    ]
  },
  {
    period: "2025365",
    numbers: [
      49,
      20,
      29,
      33,
      10,
      16,
      26
    ]
  },
  {
    period: "2025364",
    numbers: [
      31,
      22,
      2,
      11,
      43,
      28,
      12
    ]
  },
  {
    period: "2025363",
    numbers: [
      23,
      21,
      13,
      4,
      9,
      15,
      26
    ]
  },
  {
    period: "2025362",
    numbers: [
      45,
      11,
      37,
      6,
      30,
      8,
      23
    ]
  },
  {
    period: "2025361",
    numbers: [
      30,
      11,
      2,
      38,
      33,
      20,
      24
    ]
  },
  {
    period: "2025360",
    numbers: [
      27,
      6,
      44,
      15,
      39,
      12,
      41
    ]
  },
  {
    period: "2025359",
    numbers: [
      37,
      38,
      6,
      23,
      45,
      42,
      11
    ]
  },
  {
    period: "2025358",
    numbers: [
      26,
      22,
      43,
      42,
      18,
      35,
      7
    ]
  },
  {
    period: "2025357",
    numbers: [
      41,
      35,
      2,
      13,
      43,
      24,
      49
    ]
  },
  {
    period: "2025356",
    numbers: [
      40,
      11,
      8,
      36,
      13,
      3,
      24
    ]
  },
  {
    period: "2025355",
    numbers: [
      43,
      9,
      6,
      28,
      15,
      30,
      8
    ]
  },
  {
    period: "2025354",
    numbers: [
      21,
      15,
      4,
      5,
      28,
      48,
      30
    ]
  },
  {
    period: "2025353",
    numbers: [
      38,
      6,
      16,
      46,
      26,
      48,
      1
    ]
  },
  {
    period: "2025352",
    numbers: [
      25,
      9,
      29,
      26,
      10,
      2,
      44
    ]
  },
  {
    period: "2025351",
    numbers: [
      16,
      15,
      3,
      12,
      10,
      11,
      4
    ]
  },
  {
    period: "2025350",
    numbers: [
      7,
      22,
      42,
      35,
      16,
      47,
      49
    ]
  },
  {
    period: "2025349",
    numbers: [
      33,
      11,
      39,
      4,
      40,
      46,
      22
    ]
  },
  {
    period: "2025348",
    numbers: [
      31,
      26,
      44,
      21,
      22,
      34,
      16
    ]
  },
  {
    period: "2025347",
    numbers: [
      30,
      8,
      26,
      37,
      28,
      24,
      13
    ]
  },
  {
    period: "2025346",
    numbers: [
      11,
      26,
      40,
      46,
      34,
      20,
      3
    ]
  },
  {
    period: "2025345",
    numbers: [
      41,
      23,
      9,
      11,
      32,
      3,
      24
    ]
  },
  {
    period: "2025344",
    numbers: [
      11,
      21,
      42,
      10,
      47,
      40,
      27
    ]
  },
  {
    period: "2025343",
    numbers: [
      11,
      45,
      41,
      28,
      46,
      35,
      38
    ]
  },
  {
    period: "2025342",
    numbers: [
      41,
      19,
      17,
      15,
      24,
      8,
      4
    ]
  },
  {
    period: "2025341",
    numbers: [
      5,
      34,
      42,
      7,
      35,
      12,
      6
    ]
  },
  {
    period: "2025340",
    numbers: [
      45,
      17,
      15,
      28,
      22,
      10,
      16
    ]
  },
  {
    period: "2025339",
    numbers: [
      24,
      22,
      40,
      36,
      39,
      31,
      48
    ]
  },
  {
    period: "2025338",
    numbers: [
      41,
      48,
      34,
      15,
      25,
      10,
      8
    ]
  },
  {
    period: "2025337",
    numbers: [
      13,
      44,
      42,
      24,
      32,
      14,
      9
    ]
  },
  {
    period: "2025336",
    numbers: [
      20,
      6,
      15,
      10,
      13,
      42,
      17
    ]
  },
  {
    period: "2025335",
    numbers: [
      34,
      35,
      46,
      31,
      13,
      3,
      44
    ]
  },
  {
    period: "2025334",
    numbers: [
      35,
      29,
      41,
      33,
      1,
      49,
      46
    ]
  },
  {
    period: "2025333",
    numbers: [
      43,
      31,
      36,
      11,
      37,
      27,
      6
    ]
  },
  {
    period: "2025332",
    numbers: [
      44,
      23,
      45,
      30,
      19,
      8,
      26
    ]
  },
  {
    period: "2025331",
    numbers: [
      42,
      24,
      2,
      22,
      47,
      21,
      26
    ]
  },
  {
    period: "2025330",
    numbers: [
      20,
      37,
      32,
      1,
      11,
      6,
      36
    ]
  },
  {
    period: "2025329",
    numbers: [
      46,
      13,
      44,
      37,
      45,
      19,
      17
    ]
  },
  {
    period: "2025328",
    numbers: [
      28,
      34,
      13,
      8,
      22,
      15,
      3
    ]
  },
  {
    period: "2025327",
    numbers: [
      13,
      44,
      9,
      21,
      31,
      22,
      37
    ]
  },
  {
    period: "2025326",
    numbers: [
      23,
      4,
      46,
      11,
      33,
      31,
      19
    ]
  },
  {
    period: "2025325",
    numbers: [
      12,
      2,
      33,
      5,
      17,
      49,
      4
    ]
  },
  {
    period: "2025324",
    numbers: [
      49,
      30,
      31,
      38,
      10,
      28,
      15
    ]
  },
  {
    period: "2025323",
    numbers: [
      48,
      28,
      29,
      36,
      46,
      19,
      9
    ]
  },
  {
    period: "2025322",
    numbers: [
      46,
      6,
      34,
      17,
      33,
      29,
      47
    ]
  },
  {
    period: "2025321",
    numbers: [
      28,
      8,
      34,
      25,
      24,
      10,
      23
    ]
  },
  {
    period: "2025320",
    numbers: [
      33,
      40,
      20,
      48,
      34,
      7,
      28
    ]
  },
  {
    period: "2025319",
    numbers: [
      29,
      22,
      16,
      31,
      21,
      17,
      45
    ]
  },
  {
    period: "2025318",
    numbers: [
      26,
      22,
      20,
      30,
      46,
      7,
      6
    ]
  },
  {
    period: "2025317",
    numbers: [
      5,
      10,
      3,
      6,
      1,
      32,
      18
    ]
  },
  {
    period: "2025316",
    numbers: [
      20,
      29,
      40,
      42,
      17,
      25,
      24
    ]
  },
  {
    period: "2025315",
    numbers: [
      19,
      43,
      20,
      15,
      8,
      37,
      4
    ]
  },
  {
    period: "2025314",
    numbers: [
      29,
      44,
      37,
      19,
      26,
      38,
      23
    ]
  },
  {
    period: "2025313",
    numbers: [
      3,
      29,
      10,
      39,
      49,
      22,
      38
    ]
  },
  {
    period: "2025312",
    numbers: [
      46,
      18,
      47,
      35,
      3,
      1,
      14
    ]
  },
  {
    period: "2025311",
    numbers: [
      6,
      39,
      32,
      4,
      7,
      2,
      37
    ]
  },
  {
    period: "2025310",
    numbers: [
      49,
      4,
      9,
      17,
      10,
      43,
      16
    ]
  },
  {
    period: "2025309",
    numbers: [
      49,
      7,
      16,
      13,
      32,
      4,
      6
    ]
  },
  {
    period: "2025308",
    numbers: [
      45,
      48,
      46,
      14,
      40,
      1,
      39
    ]
  },
  {
    period: "2025307",
    numbers: [
      21,
      44,
      4,
      24,
      29,
      1,
      20
    ]
  },
  {
    period: "2025306",
    numbers: [
      10,
      22,
      7,
      9,
      38,
      4,
      17
    ]
  },
  {
    period: "2025305",
    numbers: [
      33,
      24,
      29,
      45,
      11,
      27,
      42
    ]
  },
  {
    period: "2025304",
    numbers: [
      12,
      47,
      43,
      34,
      39,
      19,
      48
    ]
  },
  {
    period: "2025303",
    numbers: [
      2,
      18,
      31,
      27,
      47,
      36,
      15
    ]
  },
  {
    period: "2025302",
    numbers: [
      7,
      27,
      6,
      45,
      29,
      42,
      22
    ]
  },
  {
    period: "2025301",
    numbers: [
      47,
      10,
      9,
      38,
      41,
      45,
      5
    ]
  },
  {
    period: "2025300",
    numbers: [
      17,
      32,
      39,
      26,
      29,
      24,
      40
    ]
  },
  {
    period: "2025299",
    numbers: [
      33,
      39,
      35,
      13,
      31,
      19,
      49
    ]
  },
  {
    period: "2025298",
    numbers: [
      22,
      20,
      49,
      37,
      39,
      35,
      23
    ]
  },
  {
    period: "2025297",
    numbers: [
      43,
      24,
      11,
      41,
      1,
      19,
      44
    ]
  },
  {
    period: "2025296",
    numbers: [
      31,
      29,
      23,
      5,
      49,
      17,
      22
    ]
  },
  {
    period: "2025295",
    numbers: [
      18,
      4,
      45,
      33,
      42,
      38,
      5
    ]
  },
  {
    period: "2025294",
    numbers: [
      11,
      8,
      35,
      14,
      10,
      38,
      18
    ]
  },
  {
    period: "2025293",
    numbers: [
      18,
      11,
      20,
      46,
      1,
      14,
      47
    ]
  },
  {
    period: "2025292",
    numbers: [
      31,
      4,
      28,
      40,
      37,
      10,
      2
    ]
  },
  {
    period: "2025291",
    numbers: [
      43,
      24,
      6,
      10,
      30,
      25,
      44
    ]
  },
  {
    period: "2025290",
    numbers: [
      40,
      18,
      25,
      5,
      2,
      17,
      19
    ]
  },
  {
    period: "2025289",
    numbers: [
      35,
      4,
      23,
      10,
      44,
      24,
      42
    ]
  },
  {
    period: "2025288",
    numbers: [
      44,
      8,
      17,
      1,
      2,
      47,
      14
    ]
  },
  {
    period: "2025287",
    numbers: [
      5,
      42,
      49,
      10,
      40,
      36,
      34
    ]
  },
  {
    period: "2025286",
    numbers: [
      25,
      27,
      24,
      16,
      15,
      42,
      3
    ]
  },
  {
    period: "2025285",
    numbers: [
      46,
      25,
      37,
      15,
      41,
      28,
      24
    ]
  },
  {
    period: "2025284",
    numbers: [
      21,
      6,
      12,
      13,
      49,
      38,
      41
    ]
  },
  {
    period: "2025283",
    numbers: [
      21,
      24,
      35,
      8,
      29,
      18,
      45
    ]
  },
  {
    period: "2025282",
    numbers: [
      4,
      33,
      25,
      30,
      38,
      12,
      41
    ]
  },
  {
    period: "2025281",
    numbers: [
      37,
      7,
      10,
      13,
      23,
      36,
      47
    ]
  },
  {
    period: "2025280",
    numbers: [
      36,
      49,
      44,
      32,
      35,
      28,
      42
    ]
  },
  {
    period: "2025279",
    numbers: [
      37,
      1,
      26,
      42,
      39,
      30,
      27
    ]
  },
  {
    period: "2025278",
    numbers: [
      4,
      18,
      33,
      34,
      45,
      39,
      28
    ]
  },
  {
    period: "2025277",
    numbers: [
      46,
      11,
      41,
      33,
      48,
      37,
      16
    ]
  },
  {
    period: "2025276",
    numbers: [
      16,
      22,
      34,
      13,
      21,
      25,
      9
    ]
  },
  {
    period: "2025275",
    numbers: [
      34,
      47,
      25,
      21,
      28,
      5,
      45
    ]
  },
  {
    period: "2025274",
    numbers: [
      41,
      20,
      19,
      22,
      39,
      40,
      44
    ]
  },
  {
    period: "2025273",
    numbers: [
      2,
      43,
      19,
      34,
      22,
      49,
      4
    ]
  },
  {
    period: "2025272",
    numbers: [
      1,
      4,
      29,
      41,
      10,
      21,
      36
    ]
  },
  {
    period: "2025271",
    numbers: [
      48,
      3,
      44,
      27,
      8,
      9,
      6
    ]
  },
  {
    period: "2025270",
    numbers: [
      5,
      11,
      31,
      46,
      3,
      10,
      35
    ]
  },
  {
    period: "2025269",
    numbers: [
      17,
      2,
      33,
      38,
      46,
      21,
      31
    ]
  },
  {
    period: "2025268",
    numbers: [
      39,
      27,
      1,
      45,
      5,
      31,
      10
    ]
  },
  {
    period: "2025267",
    numbers: [
      7,
      9,
      5,
      25,
      48,
      40,
      29
    ]
  }
];

// api/[[path]].ts
var memoryHistory = null;
var memoryCache = null;
var lastScrapeCheck = 0;
async function getRecords(env) {
  if (env.LOTTERY_KV) {
    try {
      const stored = await env.LOTTERY_KV.get("LOTTERY_HISTORY", { type: "json" });
      if (stored && Array.isArray(stored) && stored.length > 0) {
        return stored;
      }
    } catch (e) {
      console.error("Error reading from KV:", e);
    }
  }
  if (memoryHistory && memoryHistory.length > 0) {
    return memoryHistory;
  }
  return history_default;
}
__name(getRecords, "getRecords");
async function saveRecords(records, env) {
  memoryHistory = records;
  if (env.LOTTERY_KV) {
    try {
      await env.LOTTERY_KV.put("LOTTERY_HISTORY", JSON.stringify(records));
    } catch (e) {
      console.error("Error saving to KV:", e);
    }
  }
}
__name(saveRecords, "saveRecords");
async function getCachedPrediction(period, env) {
  if (memoryCache && memoryCache.period === period && memoryCache.prediction?.isAIPowered) {
    return memoryCache.prediction;
  }
  if (env.LOTTERY_KV) {
    try {
      const stored = await env.LOTTERY_KV.get(`PREDICTION_CACHE_${period}`, { type: "json" });
      if (stored && stored.isAIPowered) {
        return stored;
      }
    } catch (e) {
      console.error("Error reading prediction cache from KV:", e);
    }
  }
  return null;
}
__name(getCachedPrediction, "getCachedPrediction");
async function savePredictionCache(period, prediction, env) {
  memoryCache = { period, prediction };
  if (env.LOTTERY_KV) {
    try {
      await env.LOTTERY_KV.put(`PREDICTION_CACHE_${period}`, JSON.stringify(prediction), {
        expirationTtl: 86400 * 7
        // 7 days
      });
    } catch (e) {
      console.error("Error saving prediction cache to KV:", e);
    }
  }
}
__name(savePredictionCache, "savePredictionCache");
async function clearPredictionCache(period, env) {
  memoryCache = null;
  if (env.LOTTERY_KV) {
    try {
      await env.LOTTERY_KV.delete(`PREDICTION_CACHE_${period}`);
    } catch (e) {
      console.error("Error clearing prediction cache from KV:", e);
    }
  }
}
__name(clearPredictionCache, "clearPredictionCache");
async function scrapeLatest(env) {
  try {
    const url = "https://macaujc.ddcdn.cloudns.org/";
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    const text = await res.text();
    const lines = text.split("\n");
    const recordsMap = /* @__PURE__ */ new Map();
    const existing = await getRecords(env);
    for (const r of existing) {
      recordsMap.set(r.period, r.numbers);
    }
    let addedCount = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const match2 = trimmed.match(/^(\d+):\s*\[(.*?)\]/);
      if (match2) {
        const period = match2[1];
        const numsStr = match2[2];
        const numbers = numsStr.split(",").map((n) => parseInt(n.trim(), 10)).filter((n) => !isNaN(n));
        if (numbers.length > 0) {
          if (!recordsMap.has(period)) {
            addedCount++;
          }
          recordsMap.set(period, numbers);
        }
      }
    }
    const mergedList = Array.from(recordsMap.entries()).map(([period, numbers]) => ({
      period,
      numbers
    }));
    mergedList.sort((a, b) => b.period.localeCompare(a.period));
    await saveRecords(mergedList, env);
    return {
      success: true,
      count: mergedList.length,
      message: addedCount > 0 ? `Successfully integrated ${addedCount} new drawing records.` : "Data is already up to date."
    };
  } catch (err) {
    console.error("Scrape failed:", err);
    return {
      success: false,
      count: 0,
      message: `Failed to fetch live data: ${err.message}. Showing cached results.`
    };
  }
}
__name(scrapeLatest, "scrapeLatest");
async function getAIPrediction(apiKey, rawRecords, triggers, lastPredictions) {
  const latestDraw = rawRecords[0];
  const mathPredict = predictNextDraw(rawRecords, triggers, lastPredictions);
  const activeTargets = mathPredict.activeTargets;
  const activeNumbers = activeTargets.map((t) => t.number);
  if (!apiKey) {
    console.log("No GEMINI_API_KEY. Using mathematical fallback prediction.");
    return { ...mathPredict, isAIPowered: false };
  }
  try {
    const recordsText = rawRecords.slice(0, 165).map((r) => `${r.period}: [${r.numbers.join(",")}]`).join("\n");
    const prompt = `\u60A8\u662F\u4E00\u4F4D\u9AD8\u7B49\u6982\u7387\u8BBA\u4E13\u5BB6\u548C\u8D5B\u9A6C\u5F69\u7968\u6DF7\u6C8C\u5B66\u5B66\u8005\u3002
\u73B0\u5728\u6211\u4EEC\u5C06\u5411\u60A8\u63D0\u4F9B\u6FB3\u95E8\u8D5B\u9A6C\u4F1A\u6700\u8FD1\u7684 165 \u671F\u5F00\u5956\u5386\u53F2\u6570\u636E\u3002\u6BCF\u4E00\u671F\u5305\u542B 7 \u4E2A\u5F00\u5956\u53F7\u7801\uFF08\u8303\u56F4\u4ECE 01 \u5230 49\uFF09\u3002

\u3010\u91CD\u8981\u5206\u6790\u7406\u8BBA\u4E0E\u5BF9\u51B2\u89C4\u5219\u3011\uFF1A
1. \u9694\u671F\u540C\u53F7\u8F68\u8FF9\uFF08Hedge \u5BF9\u51B2\u9632\u7EBF\uFF09\uFF1A\u5F53\u524D\u6709\u4E9B\u53F7\u7801\u6B63\u5904\u4E8E\u6D3B\u8DC3\u7684\u8F68\u8FF9\u8FFD\u9010\u5468\u671F\u4E2D\u3002\u8FD9\u4E9B\u53F7\u7801\u5728\u63A5\u4E0B\u6765\u7684\u5F00\u5956\u4E2D\u51FA\u73B0\u6982\u7387\u6781\u9AD8\u3002
   - \u5904\u4E8E\u8FFD\u9010\u5468\u671F\u4E2D\u7684\u6D3B\u8DC3\u76EE\u6807\u53F7\uFF1A[${activeNumbers.join(", ")}]
   - \u26A0\uFE0F\u3010\u7EDD\u5BF9\u7981\u533A\u3011\uFF1A\u5728\u60A8\u9884\u6D4B\u7684\u201C\u4E0D\u53EF\u80FD\u5F00\u51FA\u76846\u4E2A\u53F7\u7801\u201D\u4E2D\uFF0C**\u7EDD\u5BF9\u4E0D\u80FD**\u5305\u542B\u8FD9\u51E0\u4E2A\u6D3B\u8DC3\u76EE\u6807\u53F7\u7801\uFF01\u56E0\u4E3A\u5B83\u4EEC\u968F\u65F6\u53EF\u80FD\u53CD\u5F39\u56DE\u8865\u3002

2. \u9632\u6B62\u63A8\u8350\u91CD\u590D\uFF08\u4E0A\u4E00\u671F\u6392\u9664\u91CD\u5408\u9650\u5236\uFF09\uFF1A
   - \u4E0A\u4E00\u671F\u5DF2\u6392\u9664\u76846\u4E2A\u53F7\u7801\u662F\uFF1A[${lastPredictions.join(", ")}]
   - \u26A0\uFE0F\u3010\u9650\u5236\u3011\uFF1A\u786E\u4FDD\u672C\u671F\u7684\u9884\u6D4B\u540D\u5355\u4E0E\u4E0A\u4E00\u671F\u7684 [${lastPredictions.join(", ")}] \u4E0D\u5B8C\u5168\u76F8\u540C\uFF0C\u8BA9\u6392\u9664\u540D\u5355\u5177\u6709\u5468\u671F\u65F6\u6548\u53D8\u5316\u3002

3. \u9057\u6F0F\u4E0E\u51B7\u70ED\u5BF9\u51B2\uFF1A
   - \u60A8\u5E94\u8BE5\u8BC4\u4F30 49 \u7801\u7684\u603B\u4F53\u51FA\u73B0\u9891\u6B21\u3001\u8FD1\u671F\u9057\u6F0F\u5468\u671F\uFF0C\u5E76\u7ED3\u5408\u6DF7\u6C8C\u7406\u8BBA\u63A8\u6F14\u4E0B\u4E00\u671F\uFF08\u7B2C ${parseInt(latestDraw.period, 10) + 1} \u671F\uFF09\u6700\u4E0D\u53EF\u80FD\u51FA\u73B0\u7684 6 \u4E2A\u53F7\u7801\u3002
   - \u91CD\u70B9\u8003\u8651\u957F\u671F\u6781\u5EA6\u51B7\u6001\u3001\u51FA\u73B0\u9891\u6B21\u6781\u4F4E\u3001\u6216\u8005\u8FD1\u671F\u9057\u6F0F\u5904\u4E8E\u6781\u503C\u4E0D\u7B26\u5408\u53CD\u5F39\u8D70\u52BF\u7684\u53F7\u7801\u3002

\u4EE5\u4E0B\u662F\u524D\u9762165\u671F\u5F00\u5956\u6570\u636E\uFF08\u6700\u65B0\u671F\u5728\u6700\u4E0A\u9762\uFF09\uFF1A
${recordsText}

\u8BF7\u5728\u8FDB\u884C\u9AD8\u7CBE\u5EA6\u6570\u7406\u903B\u8F91\u63A8\u65AD\u540E\uFF0C\u8BA1\u7B97\u51FA\u4E0B\u4E00\u671F\u6700\u4E0D\u53EF\u80FD\u51FA\u73B0\u76846\u4E2A\u53F7\u7801\uFF08\u8303\u56F4\u4E3A 1 \u5230 49\uFF0C\u5FC5\u987B\u662F 6 \u4E2A\u4E92\u4E0D\u76F8\u540C\u7684\u6574\u6570\uFF0C\u6309\u5347\u5E8F\u6392\u5217\uFF09\u3002

\u60A8\u5FC5\u987B\u8FD4\u56DE\u7B26\u5408\u4EE5\u4E0B JSON \u7ED3\u6784\u7684\u9884\u6D4B\uFF1A
{
  "predictedNumbers": [number, number, number, number, number, number],
  "reasoning": {
    "triggerLocking": "\u6839\u636E\u9694\u671F\u7279\u5F81\uFF0C\u8BA8\u8BBA\u6392\u9664\u540D\u5355\u4E2D\u5BF9\u5F53\u524D\u6D3B\u8DC3\u8FFD\u8E2A\u76EE\u6807\u53F7 [${activeNumbers.join(", ")}] \u6267\u884C\u7684\u5B89\u5168\u52A0\u9501\u4E0E\u9632\u56DE\u5F39\u5C4F\u969C\u8FC7\u7A0B\uFF0C\u4F7F\u7528\u6781\u5177\u4E13\u4E1A\u5EA6\u7684\u4E2D\u6587\u63CF\u7ED8",
    "edgeDeduction": "\u8BE6\u7EC6\u9610\u91CA\u9996\u5C3E\u8FB9\u7F18\u73AF\u5F62\u8FD0\u7B97\u4E0B\u5BF9\u9AD8\u56DE\u8865\u843D\u70B9\u7684\u7ED5\u9053\u5BF9\u51B2\u7B56\u7565\uFF0C\u4F7F\u7528\u6781\u5177\u4E13\u4E1A\u5EA6\u7684\u4E2D\u6587\u63CF\u7ED8",
    "omissionConclusion": "\u7ED3\u5408165\u671F\u5927\u76D8\u51B7\u6001\u6307\u6807\u53CA\u9057\u6F0F\u6CE2\u5CF0\uFF0C\u5168\u9762\u63A8\u8BBA\u8BBA\u8FF0\u6B64 6 \u4E2A\u53F7\u7801\u4E0D\u53EF\u80FD\u51FA\u73B0\u7684\u5FC5\u7136\u903B\u8F91\uFF0C\u4F7F\u7528\u6781\u5177\u4E13\u4E1A\u5EA6\u7684\u4E2D\u6587\u63CF\u7ED8"
  }
}`;
    let responseData = null;
    const configs = [
      { version: "v1beta", model: "gemini-2.5-flash" },
      { version: "v1", model: "gemini-2.5-flash" },
      { version: "v1beta", model: "gemini-3.8-flash" }
    ];
    for (const cfg of configs) {
      try {
        const url = `https://generativelanguage.googleapis.com/${cfg.version}/models/${cfg.model}:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: "application/json",
              responseSchema: {
                type: "OBJECT",
                properties: {
                  predictedNumbers: {
                    type: "ARRAY",
                    items: { type: "INTEGER" },
                    description: "6 unique numbers from 1 to 49 that are least likely to appear"
                  },
                  reasoning: {
                    type: "OBJECT",
                    properties: {
                      triggerLocking: { type: "STRING" },
                      edgeDeduction: { type: "STRING" },
                      omissionConclusion: { type: "STRING" }
                    },
                    required: ["triggerLocking", "edgeDeduction", "omissionConclusion"]
                  }
                },
                required: ["predictedNumbers", "reasoning"]
              }
            }
          })
        });
        if (response.ok) {
          responseData = await response.json();
          break;
        } else {
          console.warn(`Model ${cfg.model} (${cfg.version}) returned status ${response.status}`);
        }
      } catch (e) {
        console.warn(`Model ${cfg.model} (${cfg.version}) fetch error:`, e.message);
      }
    }
    if (!responseData) {
      return { ...mathPredict, isAIPowered: false };
    }
    const textResult = responseData.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const body = JSON.parse(textResult.trim());
    let predicted = (body.predictedNumbers || []).map((n) => parseInt(n, 10)).filter((n) => !isNaN(n) && n >= 1 && n <= 49);
    predicted = Array.from(new Set(predicted)).slice(0, 6);
    if (predicted.length !== 6) {
      return { ...mathPredict, isAIPowered: false };
    }
    predicted.sort((a, b) => a - b);
    const safePrediction = [];
    for (const num of predicted) {
      if (activeNumbers.includes(num)) {
        for (const replacement of mathPredict.predictedNumbers) {
          if (!predicted.includes(replacement) && !activeNumbers.includes(replacement) && !safePrediction.includes(replacement)) {
            safePrediction.push(replacement);
            break;
          }
        }
      } else {
        safePrediction.push(num);
      }
    }
    while (safePrediction.length < 6) {
      for (const replacement of mathPredict.predictedNumbers) {
        if (!safePrediction.includes(replacement) && !activeNumbers.includes(replacement)) {
          safePrediction.push(replacement);
          break;
        }
      }
    }
    safePrediction.sort((a, b) => a - b);
    return {
      predictedNumbers: safePrediction,
      activeTargets,
      reasoning: {
        triggerLocking: body.reasoning?.triggerLocking || mathPredict.reasoning.triggerLocking,
        edgeDeduction: body.reasoning?.edgeDeduction || mathPredict.reasoning.edgeDeduction,
        omissionConclusion: body.reasoning?.omissionConclusion || mathPredict.reasoning.omissionConclusion
      },
      isAIPowered: true
    };
  } catch (err) {
    console.error("Gemini prediction error:", err);
    return { ...mathPredict, isAIPowered: false };
  }
}
__name(getAIPrediction, "getAIPrediction");
var onRequest = /* @__PURE__ */ __name(async (context) => {
  const url = new URL(context.request.url);
  const path = url.pathname;
  const env = context.env;
  const corsHeaders = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
  if (context.request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  try {
    if (path === "/api/analyze" || path.endsWith("/analyze")) {
      const now = Date.now();
      if (now - lastScrapeCheck > 5 * 60 * 1e3) {
        lastScrapeCheck = now;
        await scrapeLatest(env);
      }
      const rawRecords = await getRecords(env);
      if (rawRecords.length === 0) {
        return new Response(JSON.stringify({ status: "error", message: "No records available." }), {
          status: 500,
          headers: corsHeaders
        });
      }
      const analysis = analyzeData(rawRecords);
      const lastPredictions = analysis.predictions.length > 0 ? analysis.predictions[analysis.predictions.length - 1].predictedNumbers : [];
      const currentPeriod = rawRecords[0]?.period || "";
      let prediction = await getCachedPrediction(currentPeriod, env);
      if (!prediction) {
        prediction = await getAIPrediction(env.GEMINI_API_KEY, rawRecords, analysis.triggers, lastPredictions);
        await savePredictionCache(currentPeriod, prediction, env);
      }
      return new Response(
        JSON.stringify({
          latestDraw: rawRecords[0],
          summary: analysis.summary,
          triggers: analysis.triggers.slice(-50),
          predictions: analysis.predictions.slice(-30),
          frequencyStats: analysis.frequencyStats,
          prediction,
          totalCount: rawRecords.length
        }),
        { headers: corsHeaders }
      );
    }
    if (path === "/api/refresh" || path.endsWith("/refresh")) {
      if (context.request.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: corsHeaders });
      }
      const result = await scrapeLatest(env);
      const rawRecords = await getRecords(env);
      const currentPeriod = rawRecords[0]?.period || "";
      if (currentPeriod) {
        await clearPredictionCache(currentPeriod, env);
      }
      if (result.success) {
        return new Response(JSON.stringify({ status: "success", message: result.message }), { headers: corsHeaders });
      } else {
        return new Response(JSON.stringify({ status: "error", message: result.message }), { status: 502, headers: corsHeaders });
      }
    }
    if (path === "/api/ai-report" || path.endsWith("/ai-report")) {
      if (context.request.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: corsHeaders });
      }
      const reqData = await context.request.json().catch(() => ({}));
      const { prediction, summary, latestDraw } = reqData;
      if (!env.GEMINI_API_KEY) {
        const fallbackReport = `### \u{1F916} AI\u8F85\u52A9\u5206\u6790\u62A5\u544A (Gemini API \u79BB\u7EBF\u72B6\u6001)

\u672C\u7CFB\u7EDF\u6B63\u5904\u4E8E\u8FD0\u884C\u72B6\u6001\uFF0C\u7531\u4E8E\u672A\u5728 Cloudflare \u73AF\u5883\u53D8\u91CF\u4E2D\u68C0\u6D4B\u5230 \`GEMINI_API_KEY\` \u5BC6\u94A5\uFF0C\u7CFB\u7EDF\u5DF2\u81EA\u52A8\u8F6C\u5165\u3010\u9AD8\u7CBE\u5EA6\u6570\u7406\u903B\u8F91\u5F15\u64CE\u3011\u672C\u5730\u8FD0\u884C\u3002

#### \u{1F4CA} \u5F53\u524D\u671F\u5F00\u5956\u5BF9\u51B2
- **\u6700\u65B0\u671F\u6570**\uFF1A${latestDraw?.period || "\u672A\u52A0\u8F7D"}
- **\u5F00\u5956\u53F7**\uFF1A[${(latestDraw?.numbers || []).join(", ")}]
- **\u6392\u9664\u5EFA\u8BAE**\uFF1A[${(prediction?.predictedNumbers || []).map((n) => n.toString().padStart(2, "0")).join(", ")}]

#### \u{1F4A1} \u7B97\u6CD5\u6267\u884C\u6307\u6807
- **\u9694\u671F\u540C\u53F7\u89E6\u53D1\u70B9\u603B\u6570**\uFF1A${summary?.totalTriggers || 0} \u6B21
- **\u57FA\u51C6\u4F4D\u8F68\u8FF9\u547D\u4E2D\u603B\u6570**\uFF1A${summary?.totalHits || 0} \u6B21
- **\u8FFD\u9010\u8865\u4F4D\u9AD8\u53D1\u6548\u7387 (1-4\u671F)**\uFF1A${summary?.hitRate1To4 ? (summary.hitRate1To4 * 100).toFixed(1) : "100"}%
- **\u4E13\u5BB6\u6392\u9664\u7B97\u6CD5\u51C6\u786E\u5EA6 (6\u7801\u5B8C\u5168\u6392\u9664)**\uFF1A${summary?.exclusionSuccessRate ? (summary.exclusionSuccessRate * 100).toFixed(1) : "85"}%

*(\u63D0\u793A\uFF1A\u82E5\u8981\u6FC0\u6D3B\u6DF1\u5EA6AI\u6F14\u8BD1\u548C\u9AD8\u7EA7\u8D8B\u52BF\u62A5\u544A\uFF0C\u8BF7\u5728 Cloudflare Pages / Workers \u73AF\u5883\u53D8\u91CF\u7BA1\u7406\u4E2D\u6DFB\u52A0 GEMINI_API_KEY\uFF01)*`;
        return new Response(JSON.stringify({ content: fallbackReport }), { headers: corsHeaders });
      }
      const numShow = (prediction?.predictedNumbers || []).map((n) => n.toString().padStart(2, "0")).join(", ");
      const activeShow = (prediction?.activeTargets || []).map((t) => `\u53F7\u7801 ${t.number} \u5728\u7B2C ${t.basePos} \u4F4D\u89E6\u53D1`).join("\u3001");
      const prompt = `\u4F60\u662F\u4E00\u4E2A\u6FB3\u95E8\u8D5B\u9A6C\u6570\u636E\u5206\u6790\u4E13\u5BB6\u3001\u9AD8\u7B49\u6982\u7387\u8BBA\u4E0E\u5F69\u7968\u6DF7\u6C8C\u5B66\u5B66\u8005\u3002
\u8BF7\u6839\u636E\u4EE5\u4E0B\u771F\u5B9E\u7684\u6570\u7406\u5206\u6790\u6A21\u578B\u8BA1\u7B97\u51FA\u7684\u7ED3\u679C\uFF0C\u751F\u6210\u4E00\u5C01\u4E13\u4E1A\u3001\u6743\u5A01\u3001\u9AD8\u667A\u5546\u611F\u89C9\u7684\u9884\u6D4B\u4E0E\u6392\u9664\u8BC4\u4F30\u62A5\u544A\u3002

\u5F53\u524D\u671F\u6570\u6570\u636E:
- \u6700\u65B0\u5F00\u5956\u671F: ${latestDraw?.period || "\u6700\u65B0"}
- \u6700\u65B0\u5F00\u5956\u53F7: [${(latestDraw?.numbers || []).join(", ")}]
- \u5F53\u524D\u56DE\u6D4B\u5927\u76D8\u6570\u636E\u603B\u6837\u672C: ${summary?.totalDraws || 165} \u671F
- \u8F68\u8FF9\u89E6\u53D1\u5668\u603B\u89E6\u53D1\u4E8B\u4EF6: ${summary?.totalTriggers || 0} \u6B21
- \u57FA\u51C6\u4F4DP\u6781\u901F\u56DE\u8865\u8F68\u8FF9\u603B\u547D\u4E2D: ${summary?.totalHits || 0} \u6B21
- 1-4\u671F\u5FEB\u901F\u8865\u4F4D\u547D\u4E2D\u5360\u6BD4: ${summary?.hitRate1To4 ? (summary.hitRate1To4 * 100).toFixed(1) : "100"}%
- \u5F53\u524D\u5728\u8FFD\u8D76\u5468\u671F\u4E2D\u7684\u6D3B\u8DC3\u76EE\u6807\u53F7: [${activeShow || "\u65E0"}]
- \u4E13\u5BB6\u6392\u9664\u7B97\u6CD5\u56DE\u6D4B\u5B8C\u5168\u6210\u529F\u7387: ${summary?.exclusionSuccessRate ? (summary.exclusionSuccessRate * 100).toFixed(1) : "80"}%
- \u7CFB\u7EDF\u4F7F\u7528\u6392\u9664\u6CD5\u63A8\u5BFC\u51FA\u7684\u4E0B\u4E00\u671F\u4E0D\u53EF\u80FD\u51FA\u73B0\u76846\u4E2A\u53F7\u7801: [${numShow}]

\u8BF7\u6839\u636E\u8FD9\u4E9B\u6570\u636E\uFF0C\u5199\u4E00\u5C01\u6DF1\u5EA6\u7684\u6FB3\u95E8\u8D5B\u9A6C\u5F69\u7968\u5206\u6790\u3002\u5185\u5BB9\u5FC5\u987B\u8986\u76D6\u4EE5\u4E0B\u4E09\u4E2A\u65B9\u9762\uFF0C\u5E76\u4F7F\u7528\u4EE5\u4E0B\u7279\u5B9A\u7684\u4E13\u4E1A\u5C0F\u6807\u9898\uFF0C\u5C55\u793A\u4F60\u7684\u5B66\u672F\u6DF1\u5EA6\u548C\u4E25\u5BC6\u903B\u8F91\uFF1A

\u4E00\u3001\u89E6\u53D1\u7279\u5F81\u4E0E\u53F7\u7801\u9501\u5B9A
\u8BE6\u7EC6\u9610\u91CA\u201C\u9694\u671F\u540C\u53F7\u201D\u5728\u672C\u6B21\u9884\u6D4B\u4E2D\u7684\u6700\u65B0\u89E6\u53D1\u52A8\u4F5C\uFF0C\u8BA1\u7B97\u76EE\u6807\u53F7\u548C\u5939\u5FC3\u53F7\uFF0C\u5206\u6790\u5B83\u4EEC\u548C\u6700\u65B0\u671F\u6D3B\u8DC3\u5EA6\u7684\u6570\u7406\u76F8\u5173\u6027\u3002

\u4E8C\u3001\u8FB9\u7F18\u7B97\u6CD5\u4E0E\u8DEF\u5F84\u63A8\u6F14
\u8BE6\u7EC6\u8BA8\u8BBA\u8FB9\u7F18\u73AF\u5F62\u8DF3\u8F6C\u903B\u8F91\uFF08\u5982\u7B2C1\u540D\u548C\u7B2C7\u540D\u9047\u5230\u8FB9\u7F18\u65F6\u7684\u8DF3\u8F6C\uFF09\u53CA\u5728\u8FD9\u4E09\u4E2A\u9884\u6D4B\u843D\u70B9\u4F4D\u7F6E\u4E0A\u7684\u5206\u5E03\u60C5\u51B5\u3002\u9610\u8FF0\u5982\u4F55\u5229\u7528\u5BF9\u51B2\u9632\u7EBF\u786E\u4FDD\u6392\u9664\u76846\u4E2A\u53F7\u7801\u4E0D\u5728\u9AD8\u6982\u7387\u56DE\u8865\u8DEF\u5F84\u4E2D\u3002

\u4E09\u3001\u9057\u6F0F\u5206\u6790\u4E0E\u6392\u9664\u7ED3\u8BBA
\u901A\u8FC7\u5927\u76D8\u51B7\u70ED\u5EA6\u4EE5\u53CA\u9057\u6F0F\u503C\uFF0C\u8BBA\u8FF0\u4E3A\u4EC0\u4E48\u63A8\u5BFC\u51FA\u7684\u8FD96\u4E2A\u53F7\u7801 [${numShow}] \u662F\u4E0B\u4E00\u671F\u6700\u4E0D\u53EF\u80FD\u51FA\u73B0\u7684\uFF0C\u5E76\u8BF4\u660E\u4F60\u7684\u6570\u636E\u5F52\u6863\u7B56\u7565\u3002

\u5B57\u6570\u8981\u6C42\u5728800\u5B57\u5DE6\u53F3\uFF0C\u8BED\u6C14\u8981\u7406\u6027\u3001\u51B7\u9759\u3001\u5145\u6EE1\u9AD8\u51C0\u503C\u5B66\u8005\u98CE\u8303\u3002\u5FC5\u987B\u4F7F\u7528 Markdown \u683C\u5F0F\u8F93\u51FA\uFF0C\u6587\u5B57\u6392\u7248\u4F18\u96C5\u7CBE\u7F8E\u3002\u4E0D\u8981\u4F7F\u7528\u5E9F\u8BDD\uFF0C\u76F4\u5954\u4E3B\u9898\u3002`;
      let content = "";
      const configs = [
        { version: "v1beta", model: "gemini-2.5-flash" },
        { version: "v1", model: "gemini-2.5-flash" },
        { version: "v1beta", model: "gemini-3.8-flash" }
      ];
      for (const cfg of configs) {
        try {
          const apiUrl = `https://generativelanguage.googleapis.com/${cfg.version}/models/${cfg.model}:generateContent?key=${env.GEMINI_API_KEY}`;
          const geminiRes = await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }]
            })
          });
          if (geminiRes.ok) {
            const geminiData = await geminiRes.json();
            content = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "";
            if (content) break;
          }
        } catch (e) {
          console.warn(`ai-report with ${cfg.model} (${cfg.version}) failed:`, e.message);
        }
      }
      if (!content) {
        return new Response(JSON.stringify({ error: "Gemini API call failed with all candidate models." }), {
          status: 500,
          headers: corsHeaders
        });
      }
      return new Response(JSON.stringify({ content }), { headers: corsHeaders });
    }
    return new Response(JSON.stringify({ error: "Not Found" }), { status: 404, headers: corsHeaders });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || "Internal Server Error" }), {
      status: 500,
      headers: corsHeaders
    });
  }
}, "onRequest");

// ../.wrangler/tmp/pages-szLfsD/functionsRoutes-0.9540902010356365.mjs
var routes = [
  {
    routePath: "/api/:path*",
    mountPath: "/api",
    method: "",
    middlewares: [],
    modules: [onRequest]
  }
];

// ../../../root/.npm/_npx/32026684e21afda6/node_modules/path-to-regexp/dist.es2015/index.js
function lexer(str) {
  var tokens = [];
  var i = 0;
  while (i < str.length) {
    var char = str[i];
    if (char === "*" || char === "+" || char === "?") {
      tokens.push({ type: "MODIFIER", index: i, value: str[i++] });
      continue;
    }
    if (char === "\\") {
      tokens.push({ type: "ESCAPED_CHAR", index: i++, value: str[i++] });
      continue;
    }
    if (char === "{") {
      tokens.push({ type: "OPEN", index: i, value: str[i++] });
      continue;
    }
    if (char === "}") {
      tokens.push({ type: "CLOSE", index: i, value: str[i++] });
      continue;
    }
    if (char === ":") {
      var name = "";
      var j = i + 1;
      while (j < str.length) {
        var code = str.charCodeAt(j);
        if (
          // `0-9`
          code >= 48 && code <= 57 || // `A-Z`
          code >= 65 && code <= 90 || // `a-z`
          code >= 97 && code <= 122 || // `_`
          code === 95
        ) {
          name += str[j++];
          continue;
        }
        break;
      }
      if (!name)
        throw new TypeError("Missing parameter name at ".concat(i));
      tokens.push({ type: "NAME", index: i, value: name });
      i = j;
      continue;
    }
    if (char === "(") {
      var count = 1;
      var pattern = "";
      var j = i + 1;
      if (str[j] === "?") {
        throw new TypeError('Pattern cannot start with "?" at '.concat(j));
      }
      while (j < str.length) {
        if (str[j] === "\\") {
          pattern += str[j++] + str[j++];
          continue;
        }
        if (str[j] === ")") {
          count--;
          if (count === 0) {
            j++;
            break;
          }
        } else if (str[j] === "(") {
          count++;
          if (str[j + 1] !== "?") {
            throw new TypeError("Capturing groups are not allowed at ".concat(j));
          }
        }
        pattern += str[j++];
      }
      if (count)
        throw new TypeError("Unbalanced pattern at ".concat(i));
      if (!pattern)
        throw new TypeError("Missing pattern at ".concat(i));
      tokens.push({ type: "PATTERN", index: i, value: pattern });
      i = j;
      continue;
    }
    tokens.push({ type: "CHAR", index: i, value: str[i++] });
  }
  tokens.push({ type: "END", index: i, value: "" });
  return tokens;
}
__name(lexer, "lexer");
function parse(str, options) {
  if (options === void 0) {
    options = {};
  }
  var tokens = lexer(str);
  var _a = options.prefixes, prefixes = _a === void 0 ? "./" : _a, _b = options.delimiter, delimiter = _b === void 0 ? "/#?" : _b;
  var result = [];
  var key = 0;
  var i = 0;
  var path = "";
  var tryConsume = /* @__PURE__ */ __name(function(type) {
    if (i < tokens.length && tokens[i].type === type)
      return tokens[i++].value;
  }, "tryConsume");
  var mustConsume = /* @__PURE__ */ __name(function(type) {
    var value2 = tryConsume(type);
    if (value2 !== void 0)
      return value2;
    var _a2 = tokens[i], nextType = _a2.type, index = _a2.index;
    throw new TypeError("Unexpected ".concat(nextType, " at ").concat(index, ", expected ").concat(type));
  }, "mustConsume");
  var consumeText = /* @__PURE__ */ __name(function() {
    var result2 = "";
    var value2;
    while (value2 = tryConsume("CHAR") || tryConsume("ESCAPED_CHAR")) {
      result2 += value2;
    }
    return result2;
  }, "consumeText");
  var isSafe = /* @__PURE__ */ __name(function(value2) {
    for (var _i = 0, delimiter_1 = delimiter; _i < delimiter_1.length; _i++) {
      var char2 = delimiter_1[_i];
      if (value2.indexOf(char2) > -1)
        return true;
    }
    return false;
  }, "isSafe");
  var safePattern = /* @__PURE__ */ __name(function(prefix2) {
    var prev = result[result.length - 1];
    var prevText = prefix2 || (prev && typeof prev === "string" ? prev : "");
    if (prev && !prevText) {
      throw new TypeError('Must have text between two parameters, missing text after "'.concat(prev.name, '"'));
    }
    if (!prevText || isSafe(prevText))
      return "[^".concat(escapeString(delimiter), "]+?");
    return "(?:(?!".concat(escapeString(prevText), ")[^").concat(escapeString(delimiter), "])+?");
  }, "safePattern");
  while (i < tokens.length) {
    var char = tryConsume("CHAR");
    var name = tryConsume("NAME");
    var pattern = tryConsume("PATTERN");
    if (name || pattern) {
      var prefix = char || "";
      if (prefixes.indexOf(prefix) === -1) {
        path += prefix;
        prefix = "";
      }
      if (path) {
        result.push(path);
        path = "";
      }
      result.push({
        name: name || key++,
        prefix,
        suffix: "",
        pattern: pattern || safePattern(prefix),
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    var value = char || tryConsume("ESCAPED_CHAR");
    if (value) {
      path += value;
      continue;
    }
    if (path) {
      result.push(path);
      path = "";
    }
    var open = tryConsume("OPEN");
    if (open) {
      var prefix = consumeText();
      var name_1 = tryConsume("NAME") || "";
      var pattern_1 = tryConsume("PATTERN") || "";
      var suffix = consumeText();
      mustConsume("CLOSE");
      result.push({
        name: name_1 || (pattern_1 ? key++ : ""),
        pattern: name_1 && !pattern_1 ? safePattern(prefix) : pattern_1,
        prefix,
        suffix,
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    mustConsume("END");
  }
  return result;
}
__name(parse, "parse");
function match(str, options) {
  var keys = [];
  var re = pathToRegexp(str, keys, options);
  return regexpToFunction(re, keys, options);
}
__name(match, "match");
function regexpToFunction(re, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.decode, decode = _a === void 0 ? function(x) {
    return x;
  } : _a;
  return function(pathname) {
    var m = re.exec(pathname);
    if (!m)
      return false;
    var path = m[0], index = m.index;
    var params = /* @__PURE__ */ Object.create(null);
    var _loop_1 = /* @__PURE__ */ __name(function(i2) {
      if (m[i2] === void 0)
        return "continue";
      var key = keys[i2 - 1];
      if (key.modifier === "*" || key.modifier === "+") {
        params[key.name] = m[i2].split(key.prefix + key.suffix).map(function(value) {
          return decode(value, key);
        });
      } else {
        params[key.name] = decode(m[i2], key);
      }
    }, "_loop_1");
    for (var i = 1; i < m.length; i++) {
      _loop_1(i);
    }
    return { path, index, params };
  };
}
__name(regexpToFunction, "regexpToFunction");
function escapeString(str) {
  return str.replace(/([.+*?=^!:${}()[\]|/\\])/g, "\\$1");
}
__name(escapeString, "escapeString");
function flags(options) {
  return options && options.sensitive ? "" : "i";
}
__name(flags, "flags");
function regexpToRegexp(path, keys) {
  if (!keys)
    return path;
  var groupsRegex = /\((?:\?<(.*?)>)?(?!\?)/g;
  var index = 0;
  var execResult = groupsRegex.exec(path.source);
  while (execResult) {
    keys.push({
      // Use parenthesized substring match if available, index otherwise
      name: execResult[1] || index++,
      prefix: "",
      suffix: "",
      modifier: "",
      pattern: ""
    });
    execResult = groupsRegex.exec(path.source);
  }
  return path;
}
__name(regexpToRegexp, "regexpToRegexp");
function arrayToRegexp(paths, keys, options) {
  var parts = paths.map(function(path) {
    return pathToRegexp(path, keys, options).source;
  });
  return new RegExp("(?:".concat(parts.join("|"), ")"), flags(options));
}
__name(arrayToRegexp, "arrayToRegexp");
function stringToRegexp(path, keys, options) {
  return tokensToRegexp(parse(path, options), keys, options);
}
__name(stringToRegexp, "stringToRegexp");
function tokensToRegexp(tokens, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.strict, strict = _a === void 0 ? false : _a, _b = options.start, start = _b === void 0 ? true : _b, _c = options.end, end = _c === void 0 ? true : _c, _d = options.encode, encode = _d === void 0 ? function(x) {
    return x;
  } : _d, _e = options.delimiter, delimiter = _e === void 0 ? "/#?" : _e, _f = options.endsWith, endsWith = _f === void 0 ? "" : _f;
  var endsWithRe = "[".concat(escapeString(endsWith), "]|$");
  var delimiterRe = "[".concat(escapeString(delimiter), "]");
  var route = start ? "^" : "";
  for (var _i = 0, tokens_1 = tokens; _i < tokens_1.length; _i++) {
    var token = tokens_1[_i];
    if (typeof token === "string") {
      route += escapeString(encode(token));
    } else {
      var prefix = escapeString(encode(token.prefix));
      var suffix = escapeString(encode(token.suffix));
      if (token.pattern) {
        if (keys)
          keys.push(token);
        if (prefix || suffix) {
          if (token.modifier === "+" || token.modifier === "*") {
            var mod = token.modifier === "*" ? "?" : "";
            route += "(?:".concat(prefix, "((?:").concat(token.pattern, ")(?:").concat(suffix).concat(prefix, "(?:").concat(token.pattern, "))*)").concat(suffix, ")").concat(mod);
          } else {
            route += "(?:".concat(prefix, "(").concat(token.pattern, ")").concat(suffix, ")").concat(token.modifier);
          }
        } else {
          if (token.modifier === "+" || token.modifier === "*") {
            throw new TypeError('Can not repeat "'.concat(token.name, '" without a prefix and suffix'));
          }
          route += "(".concat(token.pattern, ")").concat(token.modifier);
        }
      } else {
        route += "(?:".concat(prefix).concat(suffix, ")").concat(token.modifier);
      }
    }
  }
  if (end) {
    if (!strict)
      route += "".concat(delimiterRe, "?");
    route += !options.endsWith ? "$" : "(?=".concat(endsWithRe, ")");
  } else {
    var endToken = tokens[tokens.length - 1];
    var isEndDelimited = typeof endToken === "string" ? delimiterRe.indexOf(endToken[endToken.length - 1]) > -1 : endToken === void 0;
    if (!strict) {
      route += "(?:".concat(delimiterRe, "(?=").concat(endsWithRe, "))?");
    }
    if (!isEndDelimited) {
      route += "(?=".concat(delimiterRe, "|").concat(endsWithRe, ")");
    }
  }
  return new RegExp(route, flags(options));
}
__name(tokensToRegexp, "tokensToRegexp");
function pathToRegexp(path, keys, options) {
  if (path instanceof RegExp)
    return regexpToRegexp(path, keys);
  if (Array.isArray(path))
    return arrayToRegexp(path, keys, options);
  return stringToRegexp(path, keys, options);
}
__name(pathToRegexp, "pathToRegexp");

// ../../../root/.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/pages-template-worker.ts
var escapeRegex = /[.+?^${}()|[\]\\]/g;
function* executeRequest(request) {
  const requestPath = new URL(request.url).pathname;
  for (const route of [...routes].reverse()) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult) {
      for (const handler of route.middlewares.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: mountMatchResult.path
        };
      }
    }
  }
  for (const route of routes) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: true
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult && route.modules.length) {
      for (const handler of route.modules.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: matchResult.path
        };
      }
      break;
    }
  }
}
__name(executeRequest, "executeRequest");
var pages_template_worker_default = {
  async fetch(originalRequest, env, workerContext) {
    let request = originalRequest;
    const handlerIterator = executeRequest(request);
    let data = {};
    let isFailOpen = false;
    const next = /* @__PURE__ */ __name(async (input, init) => {
      if (input !== void 0) {
        let url = input;
        if (typeof input === "string") {
          url = new URL(input, request.url).toString();
        }
        request = new Request(url, init);
      }
      const result = handlerIterator.next();
      if (result.done === false) {
        const { handler, params, path } = result.value;
        const context = {
          request: new Request(request.clone()),
          functionPath: path,
          next,
          params,
          get data() {
            return data;
          },
          set data(value) {
            if (typeof value !== "object" || value === null) {
              throw new Error("context.data must be an object");
            }
            data = value;
          },
          env,
          waitUntil: workerContext.waitUntil.bind(workerContext),
          passThroughOnException: /* @__PURE__ */ __name(() => {
            isFailOpen = true;
          }, "passThroughOnException")
        };
        const response = await handler(context);
        if (!(response instanceof Response)) {
          throw new Error("Your Pages function should return a Response");
        }
        return cloneResponse(response);
      } else if ("ASSETS") {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      } else {
        const response = await fetch(request);
        return cloneResponse(response);
      }
    }, "next");
    try {
      return await next();
    } catch (error) {
      if (isFailOpen) {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      }
      throw error;
    }
  }
};
var cloneResponse = /* @__PURE__ */ __name((response) => (
  // https://fetch.spec.whatwg.org/#null-body-status
  new Response(
    [101, 204, 205, 304].includes(response.status) ? null : response.body,
    response
  )
), "cloneResponse");

// ../../../root/.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../root/.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// ../.wrangler/tmp/bundle-Gsjkzi/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = pages_template_worker_default;

// ../../../root/.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// ../.wrangler/tmp/bundle-Gsjkzi/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=functionsWorker-0.039559521452987356.mjs.map
