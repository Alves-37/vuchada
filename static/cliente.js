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
  const elSearchInput = document.getElementById("searchInput");
  const elOrderForm = document.getElementById("orderForm");
  const elSubmitOrderBtn = document.getElementById("submitOrderBtn");
  const elOrderStatus = document.getElementById("orderStatus");

  let categorias = [];
  let produtos = [];
  let selectedCategoriaId = "todos";
  let cart = [];
  let mesasIndex = new Map();

  function apiUrl(path) {
    if (!path.startsWith("/")) path = "/" + path;
    return `${API_BASE_URL}${path}`;
  }

  async function fetchJson(path, opts) {
    const res = await fetch(apiUrl(path), opts);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
    }
    return await res.json();
  }

  function formatMt(v) {
    const n = Number(v || 0);
    return `${n.toFixed(2).replace(".", ",")} MT`;
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
              <button class="add-btn" data-id="${p.id}">Adicionar</button>
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
  }

  async function loadCategorias() {
    try {
      // FastAPI não tem /api/categorias. Apenas renderizar "Todos".
      setLoading(elCategories, "Carregando...");
      categorias = [];
      renderCategorias();
    } catch (e) {
      // Mesmo com erro, não bloquear UI
      renderCategorias();
    }
  }

  async function loadProdutos() {
    try {
      setLoading(elProductsGrid, "Carregando produtos...");
      const params = new URLSearchParams();
      const search = (elSearchInput?.value || "").trim();
      if (search) params.set("q", search);
      // somente_disponiveis=true por padrão (menu)
      const path = `/public/menu/produtos${params.toString() ? "?" + params.toString() : ""}`;
      const raw = await fetchJson(path);
      // Normalizar schema do FastAPI ProdutoOut -> esperado pelo UI
      produtos = (Array.isArray(raw) ? raw : []).map((p) => ({
        id: p.id,
        name: p.nome,
        description: p.descricao,
        price: p.preco_venda,
        image_url: p.imagem,
        stock: p.estoque,
      }));
      if (!Array.isArray(produtos)) produtos = [];
      renderProdutos();
    } catch (e) {
      setError(elProductsGrid, `Erro ao carregar produtos: ${e.message}`);
    }
  }

  async function loadMesas() {
    try {
      if (!elMesaSelect) return;
      elMesaSelect.innerHTML = `<option value="">Carregando mesas...</option>`;
      const mesas = await fetchJson("/mesas/");
      if (!Array.isArray(mesas) || !mesas.length) {
        elMesaSelect.innerHTML = `<option value="">Nenhuma mesa disponível</option>`;
        return;
      }
      mesasIndex = new Map();
      mesas.forEach((m) => {
        if (m && m.id != null) mesasIndex.set(String(m.id), m);
      });
      elMesaSelect.innerHTML =
        `<option value="">Selecione...</option>` +
        mesas
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
    const mesaId = elMesaSelect?.value;
    if (!mesaId) {
      setOrderUiState("error", "Selecione uma mesa.");
      alert("Selecione uma mesa.");
      return;
    }
    if (!cart.length) {
      setOrderUiState("error", "Carrinho vazio.");
      alert("Carrinho vazio.");
      return;
    }

    const payload = {
      mesa_id: Number(mesaId),
      lugar_numero: 1,
      observacao_cozinha: null,
      itens: cart.map((it) => ({
        produto_id: Number(it.id),
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
      setOrderUiState("error", "Erro ao enviar pedido");
      alert(`Erro ao enviar pedido: ${e.message}`);
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
  });
})();
