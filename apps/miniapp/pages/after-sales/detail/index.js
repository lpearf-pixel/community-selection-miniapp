const { request, formatYuan } = require('../../../utils/api');
Page({ data: { detail: null }, onLoad(query) { request({ url: `/api/after-sales/${query.id}` }).then((detail) => this.setData({ detail: { ...detail, refund_yuan: formatYuan(detail.requested_refund_amount_cents || detail.refund_amount_cents) } })); } });
