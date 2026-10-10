import { getBuiltinBanks } from "./banks.js";
import { buildBank, prepareRows } from "./bank-builder.js";

// In-memory fallback if no KV is bound
const inMemoryStore = {
  customBanks: null, // { [bankId]: { label: string, bank: object, rows: object[] } }
  unifiedBank: null,
};

export function bankSummary(bank) {
  if (!bank || !bank.models) {
    return {
      model_count: 0,
      response_count: 0,
      number_count: 0,
      models: [],
      calibration: {},
    };
  }
  return {
    model_count: bank.models.length,
    response_count: bank.models.reduce((sum, model) => sum + (model.response_count || 0), 0),
    number_count: bank.models.reduce((sum, model) => sum + (model.valid_number_count || 0), 0),
    models: bank.models.map((model) => ({
      id: model.id,
      display_name: model.display_name,
      responses: model.response_count,
      valid_numbers: model.valid_number_count,
    })),
    calibration: bank.calibration || {},
  };
}

export async function getBankStore(env) {
  const builtin = await getBuiltinBanks();

  // If KV is bound to env.MODELTRACE_KV
  if (env && env.MODELTRACE_KV) {
    const customListRaw = await env.MODELTRACE_KV.get("custom_banks_list", "json");
    const customBanks = customListRaw || [];

    const configs = {
      gpt: { label: "GPT", builtin: true },
      claude: { label: "Claude", builtin: true },
    };

    const banks = {
      gpt: builtin.gpt,
      claude: builtin.claude,
    };

    for (const item of customBanks) {
      configs[item.id] = { label: item.label, custom: true };
      const customBankData = await env.MODELTRACE_KV.get(`bank_${item.id}`, "json");
      banks[item.id] = customBankData || null;
    }

    let unified = await env.MODELTRACE_KV.get("unified_bank", "json");
    if (!unified) {
      unified = builtin.unified;
    }

    return {
      configs,
      banks,
      unified,
      async saveCustomBank(id, label, bankData, rowsData = null) {
        if (!customBanks.some((b) => b.id === id)) {
          customBanks.push({ id, label });
          await env.MODELTRACE_KV.put("custom_banks_list", JSON.stringify(customBanks));
        }
        if (bankData) {
          await env.MODELTRACE_KV.put(`bank_${id}`, JSON.stringify(bankData));
        }
        if (rowsData) {
          await env.MODELTRACE_KV.put(`rows_${id}`, JSON.stringify(rowsData));
        }
      },
      async getCustomRows(id) {
        return (await env.MODELTRACE_KV.get(`rows_${id}`, "json")) || [];
      },
      async saveUnified(unifiedData) {
        await env.MODELTRACE_KV.put("unified_bank", JSON.stringify(unifiedData));
      },
    };
  }

  // In-memory fallback
  if (!inMemoryStore.customBanks) {
    inMemoryStore.customBanks = {};
    inMemoryStore.unifiedBank = builtin.unified;
  }

  const configs = {
    gpt: { label: "GPT", builtin: true },
    claude: { label: "Claude", builtin: true },
  };

  const banks = {
    gpt: builtin.gpt,
    claude: builtin.claude,
  };

  for (const [id, item] of Object.entries(inMemoryStore.customBanks)) {
    configs[id] = { label: item.label, custom: true };
    banks[id] = item.bank || null;
  }

  return {
    configs,
    banks,
    unified: inMemoryStore.unifiedBank,
    async saveCustomBank(id, label, bankData, rowsData = null) {
      if (!inMemoryStore.customBanks[id]) {
        inMemoryStore.customBanks[id] = { id, label, bank: bankData, rows: rowsData || [] };
      } else {
        inMemoryStore.customBanks[id].bank = bankData;
        if (rowsData) inMemoryStore.customBanks[id].rows = rowsData;
      }
    },
    async getCustomRows(id) {
      return inMemoryStore.customBanks[id]?.rows || [];
    },
    async saveUnified(unifiedData) {
      inMemoryStore.unifiedBank = unifiedData;
    },
  };
}

export function summarizeUnified(store) {
  const activeBankSummaries = {};
  for (const [id, bank] of Object.entries(store.banks)) {
    if (bank && bank.models && bank.models.length > 0) {
      const summary = bankSummary(bank);
      summary.id = id;
      summary.label = store.configs[id]?.label || id;
      activeBankSummaries[id] = summary;
    }
  }

  const values = Object.values(activeBankSummaries);
  return {
    id: "unified",
    label: "全部指纹",
    model_count: values.reduce((sum, item) => sum + item.model_count, 0),
    response_count: values.reduce((sum, item) => sum + item.response_count, 0),
    family_count: values.length,
    families: values.map((item) => ({
      id: item.id,
      label: item.label,
      model_count: item.model_count,
    })),
  };
}

export function summarizeBank(store, bankId) {
  const config = store.configs[bankId];
  if (!config) throw new Error(`未知指纹库：${bankId}`);
  const bank = store.banks[bankId];
  const summary = bankSummary(bank);
  summary.id = bankId;
  summary.label = config.label;
  return summary;
}
