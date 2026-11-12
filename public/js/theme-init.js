// テーマのちらつき防止（外部スクリプト化によりCSPインライン制約に完全準拠）
(function () {
  try {
    var t = localStorage.getItem('rs-theme');
    if (t) document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();

