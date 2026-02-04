(() => {
  const cfg = (window.APP_CONFIG || {});
  const API_BASE_URL = (cfg.API_BASE_URL || "").replace(/\/$/, "");
  const KIOSK_PIN = (cfg.KIOSK_PIN || "").trim();

  const elCategories = document.getElementById("categories");
  const elProductsGrid = document.getElementById("productsGrid");
  const elCartCount = document.getElementById("cartCount");
  const elCartModal = document.getElementById("cartModal");
  const elCartItems = document.getElementById("cartItems");
  const elCartTotal = document.getElementById("cartTotal");
  const elMesaSelect = document.getElementById("mesaSelect");
  const elOrderTypeSelect = document.getElementById("orderTypeSelect");
  const elMesaSelectionBlock = document.getElementById("mesaSelectionBlock");
  const elDistanciaBlock = document.getElementById("distanciaBlock");
  const elPayPushBlock = document.getElementById("payPushBlock");
  const elDistanciaTipo = document.getElementById("distanciaTipo");
  const elDistanciaNome = document.getElementById("distanciaNome");
  const elDistanciaTelefone = document.getElementById("distanciaTelefone");
  const elDistanciaEndereco = document.getElementById("distanciaEndereco");
  const elDistanciaTaxa = document.getElementById("distanciaTaxa");
  const elSearchInput = document.getElementById("searchInput");
  const elOrderForm = document.getElementById("orderForm");
  const elSubmitOrderBtn = document.getElementById("submitOrderBtn");
  const elOrderStatus = document.getElementById("orderStatus");
  const elTrackOrderBtn = document.getElementById("trackOrderBtn");
  let elOrderTrackModal = null;
  let elOrderTrackBody = null;

  const elMockPayBtn = document.getElementById("mockPayBtn");
  const elMockPayLink = document.getElementById("mockPayLink");
  const elMockPayQr = document.getElementById("mockPayQr");
  const elMockPayStatus = document.getElementById("mockPayStatus");

  const elRealPayProvider = document.getElementById("realPayProvider");
  const elRealPayPhone = document.getElementById("realPayPhone");
  const elRealPayBtn = document.getElementById("realPayBtn");
  const elRealPayStatus = document.getElementById("realPayStatus");

  let mockPayTimer = null;
  let lastMockPaymentId = null;

  let realPayTimer = null;
  let lastRealPaymentId = null;

  let categorias = [];
  let produtos = [];
  let selectedCategoriaId = "todos";
  let cart = [];
  let mesasIndex = new Map();
  let orderPollTimer = null;

  function apiUrl(path) {
    if (!path.startsWith("/")) path = "/" + path;
    return `${API_BASE_URL}${path}`;
  }

  function setRealPayUi(state, msg) {
    try {
      if (elRealPayStatus) {
        elRealPayStatus.style.display = "block";
        elRealPayStatus.textContent = msg || "";
        if (state === "paid") elRealPayStatus.style.color = "#16a34a";
        else if (state === "error") elRealPayStatus.style.color = "#b00020";
        else elRealPayStatus.style.color = "#374151";
      }

      if (elRealPayBtn) {
        if (state === "processing") {
          elRealPayBtn.disabled = true;
          elRealPayBtn.innerHTML = '<span class="btn-spinner"></span>Processando...';
        } else {
          elRealPayBtn.disabled = false;
          elRealPayBtn.textContent = "Pagar (Push)";
        }
      }
    } catch (e) {
      // ignore
    }
  }

  function normalizePhone(s) {
    return String(s || "").replace(/\s+/g, "").replace(/[^0-9+]/g, "");
  }

  async function startDistanceCheckout() {
    try {
      if (!cart.length) {
        openAppModal("Atenção", "Seu carrinho está vazio.");
        return;
      }

      const tipo = String(elDistanciaTipo?.value || "entrega").trim().toLowerCase();
      if (tipo !== "entrega" && tipo !== "retirada") {
        openAppModal("Atenção", "Tipo inválido. Use entrega ou retirada.");
        return;
      }

      const clienteNome = String(elDistanciaNome?.value || "").trim();
      if (!clienteNome) {
        openAppModal("Atenção", "Informe seu nome.");
        return;
      }

      const clienteTelefone = normalizePhone(elDistanciaTelefone?.value || "");
      if (!clienteTelefone || clienteTelefone.length < 8) {
        openAppModal("Atenção", "Informe um telefone válido.");
        return;
      }

      let enderecoEntrega = null;
      if (tipo === "entrega") {
        enderecoEntrega = String(elDistanciaEndereco?.value || "").trim();
        if (!enderecoEntrega) {
          openAppModal("Atenção", "Endereço é obrigatório para entrega.");
          return;
        }
      }

      const taxaEntrega = Number(elDistanciaTaxa?.value || 0) || 0;

      const provider = String(elRealPayProvider?.value || "mpesa").toLowerCase();
      const phone = normalizePhone(elRealPayPhone?.value || "");
      if (!phone || phone.length < 8) {
        openAppModal("Atenção", "Informe o número para o Push (Mpesa/eMola).");
        return;
      }

      if (realPayTimer) {
        clearInterval(realPayTimer);
        realPayTimer = null;
      }

      setRealPayUi("processing", "Iniciando checkout (distância)...");

      const payload = {
        tipo,
        cliente_nome: clienteNome,
        cliente_telefone: clienteTelefone,
        endereco_entrega: enderecoEntrega,
        taxa_entrega: taxaEntrega,
        provider,
        phone,
        itens: cart.map((it) => ({
          produto_id: String(it.id),
          quantidade: Number(it.quantidade),
          observacao: null,
        })),
      };

      const res = await fetchJson("/public/distancia/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const paymentId = res && (res.payment_id || res.paymentId || res.id);
      const pedidoUuid = res && (res.pedido_uuid || res.pedidoUuid);
      if (!paymentId || !pedidoUuid) {
        setRealPayUi("error", "Falha ao iniciar checkout à distância.");
        return;
      }

      lastRealPaymentId = String(paymentId);
      startOrderTracking(String(pedidoUuid), { openModal: true });

      setRealPayUi("pending", "Solicitação enviada. Confirme no telemóvel...");

      const tick = async () => {
        try {
          if (!lastRealPaymentId) return;
          const st = await fetchJson(`/api/payments/${encodeURIComponent(lastRealPaymentId)}`);
          const status = st && st.status ? String(st.status) : "pending";
          if (status === "paid") {
            setRealPayUi("paid", "Pagamento confirmado.");
            if (realPayTimer) {
              clearInterval(realPayTimer);
              realPayTimer = null;
            }
            cart = [];
            renderCart();
          } else if (status === "failed" || status === "canceled") {
            setRealPayUi("error", "Pagamento não concluído.");
            if (realPayTimer) {
              clearInterval(realPayTimer);
              realPayTimer = null;
            }
          } else {
            setRealPayUi("pending", "Aguardando confirmação no telemóvel...");
          }
        } catch (e) {
          // ignore
        }
      };

      tick();
      realPayTimer = setInterval(tick, 2500);
    } catch (e) {
      setRealPayUi("error", "Erro ao iniciar checkout à distância.");
    }
  }

  async function startRealPayment() {
    try {
      if (!elMesaSelect?.value) {
        openAppModal("Atenção", "Selecione uma mesa.");
        return;
      }
      if (!cart.length) {
        openAppModal("Atenção", "Seu carrinho está vazio.");
        return;
      }

      const provider = String(elRealPayProvider?.value || "mpesa").toLowerCase();
      const phone = normalizePhone(elRealPayPhone?.value || "");
      if (!phone || phone.length < 8) {
        openAppModal("Atenção", "Informe um telefone válido.");
        return;
      }

      if (realPayTimer) {
        clearInterval(realPayTimer);
        realPayTimer = null;
      }

      setRealPayUi("processing", "Criando pedido pendente...");

      const mesaId = elMesaSelect.value;
      const payload = {
        mesa_id: Number(mesaId),
        lugar_numero: 1,
        observacao_cozinha: null,
        payment_mode: "online",
        itens: cart.map((it) => ({
          produto_id: String(it.id),
          quantidade: Number(it.quantidade),
          observacao: null,
        })),
      };

      const mesaObj = mesasIndex.get(String(mesaId));
      const mesaToken = mesaObj && mesaObj.mesa_token ? String(mesaObj.mesa_token) : "";
      const orderPath = mesaToken ? `/public/mesa/${encodeURIComponent(mesaToken)}/pedidos` : "/public/pedidos";

      const headers = { "Content-Type": "application/json" };
      if (KIOSK_PIN) headers["X-Kiosk-Pin"] = KIOSK_PIN;
      const orderRes = await fetchJson(orderPath, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      if (!(orderRes && orderRes.pedido_uuid)) {
        setRealPayUi("error", "Falha ao criar pedido.");
        return;
      }

      const pedidoUuid = String(orderRes.pedido_uuid);
      startOrderTracking(pedidoUuid, { openModal: true });

      setRealPayUi("processing", "Iniciando cobrança (Push)...");

      const checkout = await fetchJson("/api/payments/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pedido_uuid: pedidoUuid, provider, phone }),
      });

      const paymentId = checkout && (checkout.payment_id || checkout.id);
      if (!paymentId) {
        setRealPayUi("error", "Falha ao iniciar pagamento.");
        return;
      }

      lastRealPaymentId = String(paymentId);
      setRealPayUi("pending", "Solicitação enviada. Confirme no telemóvel...");

      const tick = async () => {
        try {
          if (!lastRealPaymentId) return;
          const st = await fetchJson(`/api/payments/${encodeURIComponent(lastRealPaymentId)}`);
          const status = st && st.status ? String(st.status) : "pending";
          if (status === "paid") {
            setRealPayUi("paid", "Pagamento confirmado.");
            if (realPayTimer) {
              clearInterval(realPayTimer);
              realPayTimer = null;
            }
            cart = [];
            renderCart();
          } else if (status === "failed" || status === "canceled") {
            setRealPayUi("error", "Pagamento não concluído.");
            if (realPayTimer) {
              clearInterval(realPayTimer);
              realPayTimer = null;
            }
          } else {
            setRealPayUi("pending", "Aguardando confirmação no telemóvel...");
          }
        } catch (e) {
          // ignore
        }
      };

      tick();
      realPayTimer = setInterval(tick, 2500);
    } catch (e) {
      setRealPayUi("error", "Erro ao iniciar pagamento.");
    } finally {
      if (elRealPayBtn && elRealPayBtn.disabled) {
        // keep disabled only while polling
      }
    }
  }

  function setMockPayUi(state, msg, payUrl) {
    try {
      if (elMockPayStatus) {
        elMockPayStatus.style.display = "block";
        elMockPayStatus.textContent = msg || "";
        if (state === "paid") elMockPayStatus.style.color = "#16a34a";
        else if (state === "error") elMockPayStatus.style.color = "#b00020";
        else elMockPayStatus.style.color = "#374151";
      }

      if (elMockPayLink) {
        if (payUrl) {
          elMockPayLink.href = payUrl;
          elMockPayLink.style.display = "inline";
        } else {
          elMockPayLink.style.display = "none";
        }
      }

      if (elMockPayQr) {
        if (payUrl) {
          const qrUrl = "https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=" + encodeURIComponent(payUrl);
          elMockPayQr.innerHTML = `<img src="${qrUrl}" alt="QR Pagamento" style="width:180px;height:180px;border-radius:12px;border:1px solid #e5e7eb;background:#fff;" />`;
          elMockPayQr.style.display = "block";
        } else {
          elMockPayQr.style.display = "none";
          elMockPayQr.innerHTML = "";
        }
      }

      if (elMockPayBtn) {
        if (state === "processing") {
          elMockPayBtn.disabled = true;
          elMockPayBtn.innerHTML = '<span class="btn-spinner"></span>Gerando...';
        } else {
          elMockPayBtn.disabled = false;
          elMockPayBtn.textContent = "Pagar à distância";
        }
      }
    } catch (e) {
      // ignore
    }
  }

  async function startMockPayment() {
    try {
      if (!cart.length) {
        openAppModal("Atenção", "Seu carrinho está vazio.");
        return;
      }

      if (mockPayTimer) {
        clearInterval(mockPayTimer);
        mockPayTimer = null;
      }

      setMockPayUi("processing", "Gerando link de pagamento...", null);

      const amount = cartTotal();
      const res = await fetchJson("/api/payments/mock/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount,
          currency: "MZN",
          description: "Pagamento do cardápio (simulação)",
          auto_pay_seconds: 25,
        }),
      });

      const paymentId = res && (res.payment_id || res.id);
      const payPath = res && (res.payment_url || "");
      if (!paymentId || !payPath) {
        setMockPayUi("error", "Falha ao gerar pagamento.", null);
        return;
      }

      lastMockPaymentId = String(paymentId);

      const payUrl = payPath.startsWith("http") ? payPath : apiUrl(payPath);
      setMockPayUi("pending", "Aguardando pagamento...", payUrl);

      const tick = async () => {
        try {
          if (!lastMockPaymentId) return;
          const st = await fetchJson(`/api/payments/mock/${encodeURIComponent(lastMockPaymentId)}`);
          const status = st && st.status ? String(st.status) : "pending";
          if (status === "paid") {
            setMockPayUi("paid", "Pagamento confirmado (simulação).", payUrl);
            if (mockPayTimer) {
              clearInterval(mockPayTimer);
              mockPayTimer = null;
            }
          } else if (status === "not_found") {
            setMockPayUi("error", "Pagamento não encontrado.", payUrl);
            if (mockPayTimer) {
              clearInterval(mockPayTimer);
              mockPayTimer = null;
            }
          } else {
            setMockPayUi("pending", "Aguardando pagamento...", payUrl);
          }
        } catch (e) {
          // ignore polling errors
        }
      };

      tick();
      mockPayTimer = setInterval(tick, 2500);
    } catch (e) {
      setMockPayUi("error", "Erro ao iniciar pagamento.", null);
    }
  }

  function getTenantSlug() {
    try {
      const qs = new URLSearchParams(window.location.search || "");
      const fromQs = (qs.get("loja") || "").trim();
      if (fromQs) return fromQs.toLowerCase();
    } catch (e) {
      // ignore
    }
    return "restaurante";
  }

  function getTenantId() {
    try {
      const qs = new URLSearchParams(window.location.search || "");
      const fromQs = (qs.get("tenant_id") || "").trim();
      if (fromQs) return fromQs;
    } catch (e) {
      // ignore
    }
    try {
      const fromLs = (localStorage.getItem("tenant_id") || "").trim();
      if (fromLs) return fromLs;
    } catch (e) {
      // ignore
    }
    return "";
  }

  function getOrderTrackEls() {
    if (!elOrderTrackModal) elOrderTrackModal = document.getElementById("orderTrackModal");
    if (!elOrderTrackBody) elOrderTrackBody = document.getElementById("orderTrackBody");
    return { elOrderTrackModal, elOrderTrackBody };
  }

  function openOrderTracking() {
    const els = getOrderTrackEls();
    if (!els.elOrderTrackModal) return;
    els.elOrderTrackModal.style.display = "block";
  }

  function closeOrderTracking() {
    const els = getOrderTrackEls();
    if (!els.elOrderTrackModal) return;
    els.elOrderTrackModal.style.display = "none";
  }

  function clearOrderTracking() {
    try {
      localStorage.removeItem("last_pedido_uuid");
    } catch (e) {
      // ignore
    }
    if (orderPollTimer) {
      clearInterval(orderPollTimer);
      orderPollTimer = null;
    }
    const els = getOrderTrackEls();
    if (els.elOrderTrackBody) els.elOrderTrackBody.textContent = "";
    if (elTrackOrderBtn) elTrackOrderBtn.style.display = "none";
    closeOrderTracking();
  }

  function startOrderTracking(pedidoUuid, opts) {
    try {
      if (!pedidoUuid) return;
      const shouldOpen = !!(opts && opts.openModal);
      if (orderPollTimer) {
        clearInterval(orderPollTimer);
        orderPollTimer = null;
      }

      const uuid = String(pedidoUuid);
      localStorage.setItem("last_pedido_uuid", uuid);
      if (elTrackOrderBtn) elTrackOrderBtn.style.display = "inline-flex";
      if (shouldOpen) openOrderTracking();

      const tick = async () => {
        try {
          const data = await fetchJson(`/public/pedidos/uuid/${encodeURIComponent(uuid)}`);
          if (data && data.status) {
            setOrderUiState("idle", "");
            if (elOrderStatus) {
              elOrderStatus.style.display = "block";
              elOrderStatus.className = "order-status";
              elOrderStatus.textContent = `Status do pedido: ${data.status}`;
            }

            const els = getOrderTrackEls();
            if (els.elOrderTrackBody) {
              const idText = data.pedido_id != null ? `#${data.pedido_id}` : "";
              const rel = formatRelativeTime(data.updated_at);
              const updatedLine = rel ? `Atualizado ${rel}` : "";
              const totalLine = data.valor_total != null ? `Total: ${formatMt(data.valor_total)}` : "";

              let itensHtml = "";
              if (Array.isArray(data.itens) && data.itens.length) {
                itensHtml =
                  "<div style=\"margin-top:10px; font-weight:600;\">Itens</div>" +
                  "<div style=\"margin-top:6px;\">" +
                  data.itens
                    .map((it) => {
                      const nome = escapeHtml(it.produto_nome || "Produto");
                      const qtd = Number(it.quantidade || 0);
                      const subtotal = it.subtotal != null ? formatMt(it.subtotal) : "";
                      return `<div style=\"display:flex; justify-content:space-between; gap:10px; padding:4px 0;\"><div>${qtd}x ${nome}</div><div>${escapeHtml(subtotal)}</div></div>`;
                    })
                    .join("") +
                  "</div>";
              }

              els.elOrderTrackBody.innerHTML =
                `<div style=\"font-weight:700;\">Pedido ${escapeHtml(idText)}</div>` +
                `<div style=\"margin-top:6px;\">Status: <b>${escapeHtml(data.status)}</b></div>` +
                (updatedLine ? `<div style=\"margin-top:6px; color:#6b7280;\">${escapeHtml(updatedLine)}</div>` : "") +
                (totalLine ? `<div style=\"margin-top:10px;\"><b>${escapeHtml(totalLine)}</b></div>` : "") +
                itensHtml;
            }
          }
        } catch (e) {
          // ignore polling errors
        }
      };

      tick();
      orderPollTimer = setInterval(tick, 4000);
    } catch (e) {
      // ignore
    }
  }

  class AppHttpError extends Error {
    constructor(status, bodyText, bodyJson) {
      super(`HTTP ${status}`);
      this.name = "AppHttpError";
      this.status = status;
      this.bodyText = bodyText || "";
      this.bodyJson = bodyJson;
    }
  }

  let elAppModal = null;
  let elAppModalTitle = null;
  let elAppModalBody = null;

  function getAppModalEls() {
    if (!elAppModal) elAppModal = document.getElementById("appModal");
    if (!elAppModalTitle) elAppModalTitle = document.getElementById("appModalTitle");
    if (!elAppModalBody) elAppModalBody = document.getElementById("appModalBody");
    return { elAppModal, elAppModalTitle, elAppModalBody };
  }

  function openAppModal(title, message) {
    const els = getAppModalEls();
    if (!els.elAppModal) return;
    if (els.elAppModalTitle) els.elAppModalTitle.textContent = title || "Mensagem";
    if (els.elAppModalBody) els.elAppModalBody.textContent = message || "";
    els.elAppModal.style.display = "block";
  }

  function closeAppModal() {
    const els = getAppModalEls();
    if (!els.elAppModal) return;
    els.elAppModal.style.display = "none";
  }

  async function fetchJson(path, opts) {
    const tenantSlug = getTenantSlug();
    const tenantId = getTenantId();
    const nextOpts = { ...(opts || {}) };
    const nextHeaders = { ...((nextOpts.headers || {}) instanceof Headers ? Object.fromEntries(nextOpts.headers.entries()) : (nextOpts.headers || {})) };
    if (tenantId && !nextHeaders["X-Tenant-Id"]) nextHeaders["X-Tenant-Id"] = tenantId;
    if (tenantSlug && !nextHeaders["X-Tenant-Slug"]) nextHeaders["X-Tenant-Slug"] = tenantSlug;
    nextOpts.headers = nextHeaders;

    const timeoutMs = Number(nextOpts.timeoutMs || 15000);
    delete nextOpts.timeoutMs;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    nextOpts.signal = controller.signal;

    let res;
    try {
      res = await fetch(apiUrl(path), nextOpts);
    } catch (e) {
      const name = e && typeof e === "object" ? e.name : "";
      const msg = e && typeof e === "object" ? (e.message || "") : "";
      if (name === "AbortError" || /aborted/i.test(String(msg))) {
        throw new Error("Tempo esgotado ao carregar dados. Verifique se o backend (127.0.0.1:8000) está ligado.");
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch (e) {
        json = null;
      }
      const msg = (json && (json.detail || json.message)) ? (json.detail || json.message) : (text || `HTTP ${res.status}`);
      throw new Error(msg);
    }
    return await res.json();
  }

  function formatMt(v) {
    const n = Number(v || 0);
    return `${n.toFixed(2).replace(".", ",")} MT`;
  }

  function formatRelativeTime(iso) {
    try {
      if (!iso) return "";
      const d = new Date(String(iso));
      const t = d.getTime();
      if (!Number.isFinite(t)) return "";
      const diffMs = Date.now() - t;
      const diffSec = Math.floor(diffMs / 1000);
      if (diffSec < 10) return "agora";
      if (diffSec < 60) return `há ${diffSec}s`;
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return `há ${diffMin} min`;
      const diffH = Math.floor(diffMin / 60);
      if (diffH < 24) return `há ${diffH} h`;
      const diffD = Math.floor(diffH / 24);
      return `há ${diffD} d`;
    } catch (e) {
      return "";
    }
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // NOTE: keep this string safe for inline HTML attributes (no raw quotes)
  const PLACEHOLDER_IMG =
    "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22600%22%20height%3D%22400%22%3E%3Crect%20width%3D%22100%25%22%20height%3D%22100%25%22%20fill%3D%22%23f3f4f6%22%2F%3E%3Ctext%20x%3D%2250%25%22%20y%3D%2250%25%22%20dominant-baseline%3D%22middle%22%20text-anchor%3D%22middle%22%20fill%3D%22%239ca3af%22%20font-family%3D%22Segoe%20UI%2CArial%22%20font-size%3D%2228%22%3EProduto%3C%2Ftext%3E%3C%2Fsvg%3E";

  function resolveImageUrl(v) {
    const s = String(v || "").trim();
    if (!s) return PLACEHOLDER_IMG;
    if (s.startsWith("data:")) return s;
    if (s.startsWith("http://") || s.startsWith("https://")) return s;
    if (s.startsWith("/")) return `${API_BASE_URL}${s}`;
    // relative path (e.g. assets/produtos/xxx.jpg): assume it lives on the backend
    return `${API_BASE_URL}/${s.replace(/^\/+/, "")}`;
  }

  function setLoading(el, msg) {
    if (!el) return;
    el.innerHTML = `<div class="loading">${msg}</div>`;
  }

  function setError(el, msg) {
    if (!el) return;
    el.innerHTML = `<div class="error">${msg}</div>`;
  }

  function updateCartBadge() {
    const count = cart.reduce((acc, it) => acc + (Number(it.quantidade) || 0), 0);
    if (elCartCount) elCartCount.textContent = String(count);
  }

  function cartTotal() {
    return cart.reduce((acc, it) => acc + (Number(it.price) || 0) * (Number(it.quantidade) || 0), 0);
  }

  function renderCart() {
    if (!elCartItems) return;
    if (!cart.length) {
      elCartItems.innerHTML = `<div class="empty">Carrinho vazio</div>`;
    } else {
      elCartItems.innerHTML = cart
        .map(
          (it) => `
          <div class="cart-item">
            <div class="cart-item-info">
              <div class="cart-item-name">${it.name}</div>
              <div class="cart-item-price">${formatMt(it.price)}</div>
            </div>
            <div class="cart-item-actions">
              <button class="qty-btn" data-action="dec" data-id="${it.id}">-</button>
              <span class="qty">${it.quantidade}</span>
              <button class="qty-btn" data-action="inc" data-id="${it.id}">+</button>
            </div>
          </div>
        `
        )
        .join("");
    }

    if (elCartTotal) elCartTotal.textContent = formatMt(cartTotal());
    updateCartBadge();
  }

  function addToCart(prod) {
    const existing = cart.find((x) => String(x.id) === String(prod.id));
    if (existing) {
      existing.quantidade += 1;
    } else {
      cart.push({
        id: prod.id,
        name: prod.name,
        price: Number(prod.price || 0),
        quantidade: 1,
        variation_id: null,
      });
    }
    renderCart();
  }

  function changeQty(id, delta) {
    const it = cart.find((x) => String(x.id) === String(id));
    if (!it) return;
    it.quantidade = (Number(it.quantidade) || 0) + delta;
    if (it.quantidade <= 0) cart = cart.filter((x) => String(x.id) !== String(id));
    renderCart();
  }

  function renderCategorias() {
    if (!elCategories) return;
    // FastAPI menu não expõe categorias ainda. Mantemos apenas "Todos".
    categorias = [];
    elCategories.innerHTML = `<button class="category-btn active" data-id="todos">Todos</button>`;
  }

  function renderProdutos() {
    if (!elProductsGrid) return;
    const search = (elSearchInput?.value || "").trim().toLowerCase();

    let items = produtos;
    if (search) {
      items = items.filter((p) => String(p.name || "").toLowerCase().includes(search));
    }

    if (!items.length) {
      elProductsGrid.innerHTML = `<div class="empty">Nenhum produto encontrado</div>`;
      return;
    }

    elProductsGrid.innerHTML = items
      .map(
        (p) => `
        <div class="product-card">
          <img class="product-img" src="${resolveImageUrl(p.image_url)}" alt="${p.name}" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'" />
          <div class="product-body">
            <div class="product-name">${p.name}</div>
            <div class="product-desc">${p.description || ""}</div>
            <div class="product-bottom">
              <div class="product-price">${formatMt(p.price)}</div>
              <div class="product-actions">
                <button class="details-btn" data-id="${p.id}" type="button" title="Detalhes" aria-label="Detalhes">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <path d="M12 16v-4"></path>
                    <path d="M12 8h.01"></path>
                  </svg>
                </button>
                <button class="add-btn" data-id="${p.id}">Adicionar</button>
              </div>
            </div>
          </div>
        </div>
      `
      )
      .join("");

    elProductsGrid.querySelectorAll(".add-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const prod = produtos.find((x) => String(x.id) === String(id));
        if (prod) addToCart(prod);
      });
    });

    elProductsGrid.querySelectorAll(".details-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const p = produtos.find((x) => String(x.id) === String(id));
        if (!p) return;
        const nome = p.name || "";
        const desc = p.description || "";
        const cat = p.category_name || "-";
        const ativo = p.ativo === false ? "Não" : "Sim";
        const msg = `Nome: ${nome}\nDescrição: ${desc || "-"}\nCategoria: ${cat}\nAtivo: ${ativo}`;
        openAppModal("Detalhes do produto", msg);
      });
    });
  }

  async function loadCategorias() {
    try {
      // FastAPI não tem /api/categorias. Apenas renderizar "Todos".
      setLoading(elCategories, "Carregando...");
      categorias = [];
      renderCategorias();
    } catch (e) {
      setError(elCategories, "Erro ao carregar categorias");
    }
  }

  async function loadProdutos() {
    try {
      setLoading(elProductsGrid, "Carregando produtos...");
      const params = new URLSearchParams();
      const search = (elSearchInput?.value || "").trim();
      if (search) params.set("q", search);
      const slug = getTenantSlug();
      // somente_disponiveis=true por padrão (menu)
      const path = slug
        ? `/public/menu/${encodeURIComponent(slug)}/produtos${params.toString() ? "?" + params.toString() : ""}`
        : `/public/menu/produtos${params.toString() ? "?" + params.toString() : ""}`;
      const raw = await fetchJson(path);
      // Normalizar schema do FastAPI ProdutoOut -> esperado pelo UI
      produtos = (Array.isArray(raw) ? raw : [])
        .map((p) => ({
          id: p.id,
          name: p.nome,
          description: p.descricao,
          price: p.preco_venda,
          image_url: p.imagem,
          category_id: p.categoria_id,
          category_name: p.categoria_nome,
          ativo: p.ativo,
          stock: p.estoque,
        }))
        .filter((p) => p && p.id != null);

      // Evita duplicação visual caso API retorne itens repetidos
      const uniqueById = new Map();
      produtos.forEach((p) => {
        const key = String(p.id);
        if (!uniqueById.has(key)) uniqueById.set(key, p);
      });
      produtos = Array.from(uniqueById.values());

      renderProdutos();
    } catch (e) {
      setError(elProductsGrid, `Erro ao carregar produtos: ${e.message}`);
    }
  }

  async function loadMesas() {
    try {
      if (!elMesaSelect) return;
      elMesaSelect.innerHTML = `<option value="">Carregando mesas...</option>`;
      const mesas = await fetchJson("/public/mesas");
      if (!Array.isArray(mesas) || !mesas.length) {
        elMesaSelect.innerHTML = `<option value="">Nenhuma mesa disponível</option>`;
        return;
      }
      const mesasFiltradas = mesas
        .filter((m) => m && m.id != null)
        // Mesa 0 é usada como balcão/sistema e não deve aparecer no online
        .filter((m) => Number(m.numero) !== 0)
        .sort((a, b) => Number(a.numero || 0) - Number(b.numero || 0));
      mesasIndex = new Map();
      mesasFiltradas.forEach((m) => {
        mesasIndex.set(String(m.id), m);
      });
      elMesaSelect.innerHTML =
        `<option value="">Selecione...</option>` +
        mesasFiltradas
          .map((m) => `<option value="${m.id}">Mesa ${m.numero}</option>`)
          .join("");
    } catch (e) {
      if (elMesaSelect) elMesaSelect.innerHTML = `<option value="">Erro ao carregar mesas</option>`;
    }
  }

  function openCart() {
    if (!elCartModal) return;
    elCartModal.style.display = "block";
    renderCart();
    loadMesas();
    // Recalcular UI de tipo de pedido sempre que abrir o carrinho
    try {
      updateOrderTypeUi();
      const orderType = String(elOrderTypeSelect?.value || "local").trim().toLowerCase();
      if (orderType !== "distancia" && elPayPushBlock) {
        // Em pedido local, só mostrar Push depois que o usuário escolher pagar online
        elPayPushBlock.style.display = "none";
      }
    } catch (e) {
      // ignore
    }
  }

  function updateOrderTypeUi() {
    const orderType = String(elOrderTypeSelect?.value || "local").trim().toLowerCase();
    const isDistance = orderType === "distancia";
    if (elMesaSelectionBlock) elMesaSelectionBlock.style.display = isDistance ? "none" : "block";
    if (elDistanciaBlock) elDistanciaBlock.style.display = isDistance ? "block" : "none";
    // distância exige pagamento online; local só mostra quando usuário escolher pagar online
    if (elPayPushBlock) elPayPushBlock.style.display = isDistance ? "block" : "none";
  }

  function closeCart() {
    if (!elCartModal) return;
    elCartModal.style.display = "none";
  }

  function setOrderUiState(state, message) {
    if (elOrderStatus) {
      if (state === "hidden") {
        elOrderStatus.style.display = "none";
        elOrderStatus.className = "order-status";
        elOrderStatus.textContent = "";
      } else {
        elOrderStatus.style.display = "block";
        elOrderStatus.className = `order-status ${state}`;
        elOrderStatus.textContent = message || "";
      }
    }

    if (elSubmitOrderBtn) {
      if (state === "processing") {
        elSubmitOrderBtn.disabled = true;
        elSubmitOrderBtn.innerHTML = '<span class="btn-spinner"></span>Processando...';
      } else {
        elSubmitOrderBtn.disabled = false;
        elSubmitOrderBtn.textContent = "Fazer Pedido";
      }
    }
  }

  async function submitOrder() {
    setOrderUiState("hidden");
    if (!cart.length) {
      setOrderUiState("error", "Carrinho vazio.");
      openAppModal("Atenção", "Seu carrinho está vazio.");
      return;
    }

    const orderType = String(elOrderTypeSelect?.value || "local").trim().toLowerCase();
    if (orderType === "distancia") {
      // distância: pagamento obrigatório
      startDistanceCheckout();
      return;
    }

    const mesaId = elMesaSelect?.value;
    if (!mesaId) {
      setOrderUiState("error", "Selecione uma mesa.");
      openAppModal("Atenção", "Selecione uma mesa para enviar o pedido.");
      return;
    }

    const payOnline = window.confirm(
      "Como deseja pagar?\n\nOK = Pagar online (M-Pesa/eMola)\nCancelar = Pagar no local (caixa)"
    );
    if (payOnline) {
      if (elPayPushBlock) elPayPushBlock.style.display = "block";
      // orientar o usuário a preencher telefone e clicar em Pagar (Push)
      setRealPayUi("pending", "Preencha o telefone e clique em 'Pagar (Push)'.");
      try {
        elRealPayPhone?.focus();
      } catch (e) {
        // ignore
      }
      return;
    }

    const payload = {
      mesa_id: Number(mesaId),
      lugar_numero: 1,
      observacao_cozinha: null,
      payment_mode: "balcao",
      itens: cart.map((it) => ({
        produto_id: String(it.id),
        quantidade: Number(it.quantidade),
        observacao: null,
      })),
    };

    const mesaObj = mesasIndex.get(String(mesaId));
    const mesaToken = mesaObj && mesaObj.mesa_token ? String(mesaObj.mesa_token) : "";

    // Prefer token route to avoid kiosk PIN requirement
    const orderPath = mesaToken ? `/public/mesa/${encodeURIComponent(mesaToken)}/pedidos` : "/public/pedidos";

    console.log("[CARDAPIO] Enviando pedido...");
    console.log("[CARDAPIO] API_BASE_URL:", API_BASE_URL || "(vazio)");
    console.log("[CARDAPIO] Endpoint:", apiUrl(orderPath));
    console.log("[CARDAPIO] Mesa:", payload.mesa_id, "Itens:", payload.itens.length);
    console.log("[CARDAPIO] X-Kiosk-Pin:", KIOSK_PIN ? "(enviado)" : "(não enviado)");
    console.log("[CARDAPIO] Mesa token:", mesaToken ? "(usando token)" : "(sem token)");

    try {
      setOrderUiState("processing");
      const headers = { "Content-Type": "application/json" };
      if (KIOSK_PIN) headers["X-Kiosk-Pin"] = KIOSK_PIN;
      const res = await fetchJson(orderPath, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      console.log("[CARDAPIO] Resposta do servidor:", res);
      if (res && res.pedido_id) {
        setOrderUiState("success", "Pedido Nº " + res.pedido_id + " já foi enviado");
        if (res.pedido_uuid) startOrderTracking(res.pedido_uuid, { openModal: true });
        cart = [];
        renderCart();
        setTimeout(() => {
          setOrderUiState("hidden");
          closeCart();
        }, 1600);
      } else {
        setOrderUiState("error", "Falha ao enviar pedido");
        alert("Falha ao enviar pedido");
      }
    } catch (e) {
      console.error("[CARDAPIO] Erro ao enviar pedido para", apiUrl(orderPath), e);
      let friendly = "Erro ao enviar pedido.";
      if (e && e.name === "AppHttpError") {
        const detail = e.bodyJson && typeof e.bodyJson === "object" ? e.bodyJson.detail : null;
        if (e.status === 409) {
          // Conflito: normalmente falta de estoque
          friendly = detail ? String(detail) : "Estoque insuficiente para um ou mais itens.";
        } else if (detail) {
          friendly = String(detail);
        } else if (e.bodyText) {
          friendly = String(e.bodyText);
        } else {
          friendly = `Falha no servidor (HTTP ${e.status}).`;
        }
      } else if (e && e.message) {
        friendly = String(e.message);
      }

      setOrderUiState("error", "Não foi possível enviar o pedido");
      openAppModal("Não foi possível enviar", friendly);
    } finally {
      if (elSubmitOrderBtn) {
        // If success, UI will be reset by timeout. If not, re-enable now.
        if (!(elOrderStatus && elOrderStatus.className.includes("success"))) {
          setOrderUiState("idle", "");
        }
      }
    }
  }

  // Expose minimal functions used by HTML
  window.openCart = openCart;
  window.closeCart = closeCart;
  window.submitOrder = submitOrder;
  window.closeAppModal = closeAppModal;
  window.openOrderTracking = openOrderTracking;
  window.closeOrderTracking = closeOrderTracking;
  window.clearOrderTracking = clearOrderTracking;
  window.startMockPayment = startMockPayment;
  window.startRealPayment = startRealPayment;

  document.addEventListener("click", (e) => {
    const btn = e.target;
    if (!(btn instanceof HTMLElement)) return;
    if (btn.classList.contains("qty-btn")) {
      const id = btn.getAttribute("data-id");
      const action = btn.getAttribute("data-action");
      if (id && action === "inc") changeQty(id, 1);
      if (id && action === "dec") changeQty(id, -1);
    }
  });

  if (elSearchInput) {
    elSearchInput.addEventListener("input", () => {
      // Atualiza grid localmente e também recarrega do backend (pois /api/produtos aceita busca)
      loadProdutos();
    });
  }

  if (elOrderForm) {
    elOrderForm.addEventListener("submit", (e) => {
      e.preventDefault();
      submitOrder();
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    loadCategorias();
    loadProdutos();
    updateCartBadge();

    // Reset UI de pagamento simulado ao iniciar
    try {
      if (elMockPayLink) elMockPayLink.style.display = "none";
      if (elMockPayQr) elMockPayQr.style.display = "none";
      if (elMockPayStatus) elMockPayStatus.style.display = "none";
      if (elRealPayStatus) elRealPayStatus.style.display = "none";
    } catch (e) {
      // ignore
    }

    const lastUuid = localStorage.getItem("last_pedido_uuid");
    // Ao voltar ao cardápio, manter acompanhamento em background, mas NÃO abrir modal automaticamente.
    if (lastUuid) startOrderTracking(lastUuid, { openModal: false });

    if (elOrderTypeSelect) {
      elOrderTypeSelect.addEventListener("change", updateOrderTypeUi);
      updateOrderTypeUi();
    }
  });
})();
