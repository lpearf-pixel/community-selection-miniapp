const COMMUNITY_KEY = 'selected_community';
const PICKUP_STORE_KEY = 'selected_pickup_store';

function getSelectedCommunity() { return wx.getStorageSync(COMMUNITY_KEY) || null; }
function setSelectedCommunity(community) { wx.setStorageSync(COMMUNITY_KEY, community || null); return community || null; }
function getSelectedPickupStore() { return wx.getStorageSync(PICKUP_STORE_KEY) || null; }
function setSelectedPickupStore(store) { wx.setStorageSync(PICKUP_STORE_KEY, store || null); return store || null; }
function clearSelectedLocation() { wx.removeStorageSync(COMMUNITY_KEY); wx.removeStorageSync(PICKUP_STORE_KEY); }

module.exports = { getSelectedCommunity, setSelectedCommunity, getSelectedPickupStore, setSelectedPickupStore, clearSelectedLocation, COMMUNITY_KEY, PICKUP_STORE_KEY };
