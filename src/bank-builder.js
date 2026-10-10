import {
  DIMENSION,
  ALPHA,
  ORDERED_BLOCK_WEIGHT,
  hellingerFeature,
  orderedBlockFeature,
  robustScoreNumbers,
  dot,
  subtractBasis,
  parseNumbers,
  countNumbers,
} from "./fingerprint.js";

function jacobi(A, maxIter = 100) {
  const n = A.length;
  const V = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))
  );
  const D = A.map((row) => row.slice());

  for (let iter = 0; iter < maxIter; iter++) {
    let maxVal = 0;
    let p = 0;
    let q = 1;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (Math.abs(D[i][j]) > maxVal) {
          maxVal = Math.abs(D[i][j]);
          p = i;
          q = j;
        }
      }
    }
    if (maxVal < 1e-15) break;

    const app = D[p][p];
    const aqq = D[q][q];
    const apq = D[p][q];

    const phi = 0.5 * Math.atan2(2 * apq, aqq - app);
    const c = Math.cos(phi);
    const s = Math.sin(phi);

    for (let i = 0; i < n; i++) {
      const vip = V[i][p];
      const viq = V[i][q];
      V[i][p] = c * vip - s * viq;
      V[i][q] = s * vip + c * viq;
    }

    const new_app = c * c * app - 2 * s * c * apq + s * s * aqq;
    const new_aqq = s * s * app + 2 * s * c * apq + c * c * aqq;

    for (let i = 0; i < n; i++) {
      if (i !== p && i !== q) {
        const dip = D[i][p];
        const diq = D[i][q];
        D[i][p] = D[p][i] = c * dip - s * diq;
        D[i][q] = D[q][i] = s * dip + c * diq;
      }
    }
    D[p][p] = new_app;
    D[q][q] = new_aqq;
    D[p][q] = D[q][p] = 0;
  }

  const eigenvalues = D.map((_, i) => D[i][i]);
  const indices = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => eigenvalues[b] - eigenvalues[a]
  );
  const sortedW = indices.map((i) => eigenvalues[i]);
  const sortedV = Array.from({ length: n }, (_, r) => indices.map((c) => V[r][c]));
  return { eigenvalues: sortedW, eigenvectors: sortedV };
}

export function svdGram(A) {
  const M = A.length;
  const N = A[0].length;
  const G = Array.from({ length: M }, () => Array(M).fill(0));
  for (let i = 0; i < M; i++) {
    for (let j = 0; j < M; j++) {
      let sum = 0;
      for (let k = 0; k < N; k++) sum += A[i][k] * A[j][k];
      G[i][j] = sum;
    }
  }
  const { eigenvalues, eigenvectors } = jacobi(G);
  const s = eigenvalues.map((val) => Math.sqrt(Math.max(val, 0)));
  const vh = Array.from({ length: M }, (_, i) => {
    const row = Array(N).fill(0);
    if (s[i] > 1e-12) {
      for (let k = 0; k < N; k++) {
        let sum = 0;
        for (let j = 0; j < M; j++) {
          sum += A[j][k] * eigenvectors[j][i];
        }
        row[k] = sum / s[i];
      }
    }
    return row;
  });
  return { s, vh };
}

export function fitRobustArtifacts(rows, modelIds) {
  const environments = [...new Set(rows.map((row) => row.condition_id))].sort();
  const complete = environments.filter((environment) => {
    const sources = new Set(
      rows.filter((row) => row.condition_id === environment).map((row) => row.source)
    );
    return modelIds.every((modelId) => sources.has(modelId));
  });
  const robustReady = complete.length > 0;
  const robustRows = complete.length > 0 ? rows.filter((row) => complete.includes(row.condition_id)) : rows;

  const features = robustRows.map((row) => hellingerFeature(row.counts));
  const numFeatures = features.length;
  const featureDim = DIMENSION;

  const featureMean = Array(featureDim).fill(0);
  for (let j = 0; j < featureDim; j++) {
    let sum = 0;
    for (let i = 0; i < numFeatures; i++) sum += features[i][j];
    featureMean[j] = sum / numFeatures;
  }

  const featureScale = Array(featureDim).fill(0);
  for (let j = 0; j < featureDim; j++) {
    let sumSq = 0;
    for (let i = 0; i < numFeatures; i++) {
      const diff = features[i][j] - featureMean[j];
      sumSq += diff * diff;
    }
    const std = Math.sqrt(sumSq / numFeatures);
    featureScale[j] = std < 1e-12 ? 1.0 : std;
  }

  let standardized = features.map((feat) =>
    feat.map((val, j) => (val - featureMean[j]) / featureScale[j])
  );

  const nuisanceEnvironments = [
    ...new Set(robustRows.map((row) => row.nuisance_condition_id || row.condition_id)),
  ].sort();
  const environmentMeans = [];
  for (const env of nuisanceEnvironments) {
    const matching = [];
    for (let i = 0; i < robustRows.length; i++) {
      if ((robustRows[i].nuisance_condition_id || robustRows[i].condition_id) === env) {
        matching.push(standardized[i]);
      }
    }
    const meanRow = Array(featureDim).fill(0);
    for (let j = 0; j < featureDim; j++) {
      let sum = 0;
      for (let i = 0; i < matching.length; i++) sum += matching[i][j];
      meanRow[j] = sum / matching.length;
    }
    environmentMeans.push(meanRow);
  }

  const meanOffset = Array(featureDim).fill(0);
  for (let j = 0; j < featureDim; j++) {
    let sum = 0;
    for (let i = 0; i < environmentMeans.length; i++) sum += environmentMeans[i][j];
    meanOffset[j] = sum / environmentMeans.length;
  }
  const offsets = environmentMeans.map((row) => row.map((val, j) => val - meanOffset[j]));

  let basis = [];
  if (offsets.length > 1) {
    const { s, vh } = svdGram(offsets);
    const s0 = s[0] || 0;
    let rank = 0;
    for (let i = 0; i < s.length; i++) {
      if (s[i] > s0 * 1e-8) rank++;
    }
    rank = Math.min(2, rank);
    basis = vh.slice(0, rank);
    standardized = standardized.map((row) => subtractBasis(row, basis));
  }

  const centroids = modelIds.map((modelId) => {
    const matching = [];
    for (let i = 0; i < robustRows.length; i++) {
      if (robustRows[i].source === modelId) matching.push(standardized[i]);
    }
    const meanRow = Array(featureDim).fill(0);
    for (let j = 0; j < featureDim; j++) {
      let sum = 0;
      for (let i = 0; i < matching.length; i++) sum += matching[i][j];
      meanRow[j] = sum / matching.length;
    }
    const norm = Math.max(Math.sqrt(dot(meanRow, meanRow)), 1e-12);
    return meanRow.map((val) => val / norm);
  });

  const orderedFeatures = robustRows.map((row) => orderedBlockFeature(row.numbers));
  const orderedDim = orderedFeatures[0].length;
  const orderedMean = Array(orderedDim).fill(0);
  for (let j = 0; j < orderedDim; j++) {
    let sum = 0;
    for (let i = 0; i < numFeatures; i++) sum += orderedFeatures[i][j];
    orderedMean[j] = sum / numFeatures;
  }
  const orderedScale = Array(orderedDim).fill(0);
  for (let j = 0; j < orderedDim; j++) {
    let sumSq = 0;
    for (let i = 0; i < numFeatures; i++) {
      const diff = orderedFeatures[i][j] - orderedMean[j];
      sumSq += diff * diff;
    }
    const std = Math.sqrt(sumSq / numFeatures);
    orderedScale[j] = std < 1e-12 ? 1.0 : std;
  }

  let orderedStandardized = orderedFeatures.map((feat) =>
    feat.map((val, j) => (val - orderedMean[j]) / orderedScale[j])
  );

  const orderedEnvironmentMeans = [];
  for (const env of nuisanceEnvironments) {
    const matching = [];
    for (let i = 0; i < robustRows.length; i++) {
      if ((robustRows[i].nuisance_condition_id || robustRows[i].condition_id) === env) {
        matching.push(orderedStandardized[i]);
      }
    }
    const meanRow = Array(orderedDim).fill(0);
    for (let j = 0; j < orderedDim; j++) {
      let sum = 0;
      for (let i = 0; i < matching.length; i++) sum += matching[i][j];
      meanRow[j] = sum / matching.length;
    }
    orderedEnvironmentMeans.push(meanRow);
  }

  const meanOrderedOffset = Array(orderedDim).fill(0);
  for (let j = 0; j < orderedDim; j++) {
    let sum = 0;
    for (let i = 0; i < orderedEnvironmentMeans.length; i++) sum += orderedEnvironmentMeans[i][j];
    meanOrderedOffset[j] = sum / orderedEnvironmentMeans.length;
  }
  const orderedOffsets = orderedEnvironmentMeans.map((row) =>
    row.map((val, j) => val - meanOrderedOffset[j])
  );

  let orderedBasis = [];
  if (orderedOffsets.length > 1) {
    const { s, vh } = svdGram(orderedOffsets);
    const s0 = s[0] || 0;
    let rank = 0;
    for (let i = 0; i < s.length; i++) {
      if (s[i] > s0 * 1e-8) rank++;
    }
    rank = Math.min(2, rank);
    orderedBasis = vh.slice(0, rank);
    orderedStandardized = orderedStandardized.map((row) => subtractBasis(row, orderedBasis));
  }

  const orderedCentroids = modelIds.map((modelId) => {
    const matching = [];
    for (let i = 0; i < robustRows.length; i++) {
      if (robustRows[i].source === modelId) matching.push(orderedStandardized[i]);
    }
    const meanRow = Array(orderedDim).fill(0);
    for (let j = 0; j < featureDim; j++) {}
    for (let j = 0; j < orderedDim; j++) {
      let sum = 0;
      for (let i = 0; i < matching.length; i++) sum += matching[i][j];
      meanRow[j] = sum / matching.length;
    }
    const norm = Math.max(Math.sqrt(dot(meanRow, meanRow)), 1e-12);
    return meanRow.map((val) => val / norm);
  });

  const unprojectedOrdered = orderedFeatures.map((feat) =>
    feat.map((val, j) => (val - orderedMean[j]) / orderedScale[j])
  );
  const templateEnvironments = complete.length > 0 ? complete : [null];
  const orderedEnvironmentCentroids = [];
  for (const env of templateEnvironments) {
    const envCentroids = [];
    for (const modelId of modelIds) {
      const matching = [];
      for (let i = 0; i < robustRows.length; i++) {
        if (
          (env === null || robustRows[i].condition_id === env) &&
          robustRows[i].source === modelId
        ) {
          matching.push(unprojectedOrdered[i]);
        }
      }
      const meanRow = Array(orderedDim).fill(0);
      for (let j = 0; j < orderedDim; j++) {
        let sum = 0;
        for (let i = 0; i < matching.length; i++) sum += matching[i][j];
        meanRow[j] = sum / (matching.length || 1);
      }
      const norm = Math.max(Math.sqrt(dot(meanRow, meanRow)), 1e-12);
      envCentroids.push(meanRow.map((val) => val / norm));
    }
    orderedEnvironmentCentroids.push(envCentroids);
  }

  return {
    model_order: modelIds,
    robust_ready: robustReady,
    training_rows: robustRows.length,
    complete_environments: complete,
    hellinger: {
      feature_mean: featureMean,
      feature_scale: featureScale,
      nuisance_rank: basis.length,
      nuisance_environments: nuisanceEnvironments,
      nuisance_basis: basis,
      centroids,
    },
    ordered_blocks: {
      weight: ORDERED_BLOCK_WEIGHT,
      feature: "four position blocks x 16 value bins plus final-digit distribution",
      feature_mean: orderedMean,
      feature_scale: orderedScale,
      nuisance_rank: orderedBasis.length,
      nuisance_basis: orderedBasis,
      centroids: orderedCentroids,
      environment_centroids: orderedEnvironmentCentroids,
    },
  };
}

function combinations(arr, k) {
  if (k === 0) return [[]];
  if (arr.length === 0) return [];
  const head = arr[0];
  const tail = arr.slice(1);
  const withHead = combinations(tail, k - 1).map((comb) => [head, ...comb]);
  const withoutHead = combinations(tail, k);
  return [...withHead, ...withoutHead];
}

export function calibrationRecords(rows, modelIds, queryCount) {
  const records = [];
  const conditions = [...new Set(rows.map((row) => row.condition_id))].sort();
  for (const condition of conditions) {
    const rawChallengeIds = [
      ...new Set(
        rows.filter((row) => row.condition_id === condition).map((row) => row.challenge_id)
      ),
    ].sort();
    const challengeIds = rawChallengeIds.filter((challengeId) =>
      modelIds.every((modelId) =>
        rows.some(
          (row) => row.source === modelId && row.challenge_id === challengeId
        )
      )
    );
    if (challengeIds.length < queryCount) continue;

    for (const heldIds of combinations(challengeIds, queryCount)) {
      const heldSet = new Set(heldIds);
      const train = rows.filter((row) => !heldSet.has(row.challenge_id));
      const robust = fitRobustArtifacts(train, modelIds);
      const scoreBank = { robust };

      for (let truthIndex = 0; truthIndex < modelIds.length; truthIndex++) {
        const modelId = modelIds[truthIndex];
        const held = rows.filter(
          (row) => row.source === modelId && heldSet.has(row.challenge_id)
        );
        if (held.length !== queryCount) continue;

        const responseScores = held.map((row) => robustScoreNumbers(row.numbers, scoreBank));
        const combined = Array.from({ length: modelIds.length }, (_, index) => {
          let sum = 0;
          for (let i = 0; i < responseScores.length; i++) sum += responseScores[i][index];
          return sum / queryCount;
        });
        records.push({ combined, truthIndex });
      }
    }
  }
  return records;
}

export function fitBeta(records) {
  let bestBeta = 1.0;
  let bestLoss = Infinity;
  for (let step = 0; step <= 800; step++) {
    const beta = Math.exp(Math.log(0.05) + (step * (Math.log(12.0) - Math.log(0.05))) / 800);
    let loss = 0;
    for (const { combined, truthIndex } of records) {
      const scaled = combined.map((val) => beta * val);
      const maximum = Math.max(...scaled);
      let expSum = 0;
      for (let i = 0; i < scaled.length; i++) expSum += Math.exp(scaled[i] - maximum);
      const logSum = maximum + Math.log(expSum);
      loss += logSum - scaled[truthIndex];
    }
    loss /= records.length;
    if (loss < bestLoss) {
      bestBeta = beta;
      bestLoss = loss;
    }
  }
  return { beta: bestBeta, nll: bestLoss };
}

export function buildBank(rows, fallbackCalibration = null) {
  const modelIds = [...new Set(rows.map((row) => row.source))];
  const modelEntries = [];

  for (const modelId of modelIds) {
    const selected = rows.filter((row) => row.source === modelId);
    const pooled = Array.from({ length: DIMENSION }, (_, index) => {
      let sum = 0;
      for (const row of selected) sum += row.counts[index];
      return sum;
    });
    const familyId = selected[0]?.family_id;
    const familyName = selected[0]?.family_name;

    const conditionsCount = {};
    for (const row of selected) {
      conditionsCount[row.condition_id] = (conditionsCount[row.condition_id] || 0) + 1;
    }

    modelEntries.push({
      id: modelId,
      display_name: modelId,
      family: familyId,
      family_name: familyName,
      response_count: selected.length,
      valid_number_count: selected.reduce((sum, row) => sum + row.numbers.length, 0),
      conditions: conditionsCount,
      counts: pooled,
    });
  }

  const robust = fitRobustArtifacts(rows, modelIds);
  const calibration = {};

  for (const queryCount of [1, 2, 3]) {
    const key = String(queryCount);
    let records = [];
    try {
      records = calibrationRecords(rows, modelIds, queryCount);
    } catch {
      records = [];
    }

    if (records.length > 0) {
      const { beta, nll } = fitBeta(records);
      const correct = records.filter(({ combined, truthIndex }) => {
        let bestIdx = 0;
        let maxVal = -Infinity;
        for (let i = 0; i < combined.length; i++) {
          if (combined[i] > maxVal) {
            maxVal = combined[i];
            bestIdx = i;
          }
        }
        return bestIdx === truthIndex;
      }).length;
      calibration[key] = {
        beta,
        cv_accuracy: correct / records.length,
        cv_correct: correct,
        cv_samples: records.length,
        cv_nll: nll,
        fallback: false,
      };
    } else {
      const previous = fallbackCalibration ? fallbackCalibration[key] : null;
      calibration[key] = {
        ...(previous || {
          beta: 1.0,
          cv_accuracy: null,
          cv_correct: 0,
          cv_samples: 0,
          cv_nll: null,
        }),
        fallback: true,
      };
    }
  }

  const providers = [...new Set(rows.map((row) => row.provider).filter(Boolean))].sort();
  return {
    schema: "robust-number-fingerprint-bank",
    built_at: new Date().toISOString(),
    method: {
      name: "Ordered-block + nuisance-Hellinger",
      range: [1, 355],
      alpha: ALPHA,
      ordered_block_weight: robust.ordered_blocks.weight,
      parser: "longest digit run; alphabetic separators split runs; retain values 1..355",
      response_score: "shared nuisance-Hellinger and ordered-block environment/nuisance fusion",
      aggregation: "mean of response-wise fused class z-scores",
      probability: "uniform-prior softmax with fusion-specific grouped cross-validation temperature scaling",
    },
    recommended_queries: 3,
    minimum_valid_numbers: 80,
    source_scope: "Reference outputs enrolled for the listed model labels.",
    providers,
    models: modelEntries,
    robust,
    calibration,
  };
}

export function prepareRows(rawRows) {
  return rawRows
    .filter((row) => row.strict_valid !== false)
    .map((row) => {
      const numbers = row.numbers || parseNumbers(row.text || "");
      const counts = row.counts || countNumbers(numbers);
      return {
        ...row,
        numbers,
        counts,
      };
    });
}
