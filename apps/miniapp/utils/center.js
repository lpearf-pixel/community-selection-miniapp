const { request, formatYuan } = require('./api');

function getMeCenterSummary() {
  return request({ url: '/api/me/center-summary' });
}

function getLeaderCenterSummary() {
  return request({ url: '/api/leaders/me/center-summary' });
}

function formatCenterMoney(cents) {
  return `¥${formatYuan(cents)}`;
}

function toLeaderCenterViewModel(summary) {
  const source = summary || {};
  const rewards = source.rewards || {};
  const withdrawals = source.withdrawals || {};
  return {
    ...source,
    rewards: {
      ...rewards,
      pending_text: formatCenterMoney(rewards.pending_cents),
      available_text: formatCenterMoney(rewards.available_cents),
      withdrawing_text: formatCenterMoney(rewards.withdrawing_cents),
      withdrawn_text: formatCenterMoney(rewards.withdrawn_cents)
    },
    withdrawals: {
      ...withdrawals,
      latest: (withdrawals.latest || []).map((item) => ({
        ...item,
        amount_text: formatCenterMoney(item.amount_cents)
      }))
    }
  };
}

module.exports = {
  getMeCenterSummary,
  getLeaderCenterSummary,
  formatCenterMoney,
  toLeaderCenterViewModel
};
