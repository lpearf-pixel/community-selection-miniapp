const { request } = require('../../../utils/api');
Page({ data: { code: null }, onLoad(query) { request({ url: `/api/me/orders/${query.id}/pickup-code` }).then((code) => this.setData({ code })); } });
