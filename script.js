// ================================
// MAPA VIVO DE ERROS – FC GRU9
// Script principal
// ================================

// ===== CONFIGURAÇÃO DO LAYOUT =====

// Ajuste aqui conforme o FC
const CONFIG = {
    blocos: {
        "A": { corredores: [100, 300], bins: [100, 300] },
        "B1": { corredores: [100, 300], bins: [100, 300] },
        "B2": { corredores: [401, 600], bins: [100, 300] },
        "C": { corredores: [100, 300], bins: [100, 300] }
    },
    blocoInicial: "A"
};

// ================================

let dadosCSV = {};
let blocoAtual = CONFIG.blocoInicial;

// ===== CARREGAR CSV =====
async function carregarCSV() {
    try {
        const response = await fetch("./dados.csv");
        if (!response.ok) throw new Error("CSV não encontrado");
        const texto = await response.text();
        dadosCSV = processarCSV(texto);
        inicializarMapa();
    } catch (erro) {
        document.getElementById("mapa").innerHTML =
            "<p style='color:red'>❌ Erro ao carregar dados.csv</p>";
        console.error("Erro ao carregar CSV:", erro);
    }
}

// ===== PROCESSAR CSV =====
function processarCSV(texto) {
    const linhas = texto.trim().split("\n");
    const resultado = {};

    for (let i = 1; i < linhas.length; i++) {
        const linha = linhas[i].trim();
        if (!linha) continue;

        const [corredor, bin, status] = linha.split(",");

        if (!resultado[corredor]) resultado[corredor] = {};
        resultado[corredor][bin] = status.trim().toUpperCase();
    }

    return resultado;
}

// ===== GERAR SELETOR DE BLOCOS =====
function inicializarMapa() {
    const container = document.getElementById("mapa");

    // Criar seletor
    const seletor = document.createElement("select");
    seletor.id = "seletorBloco";

    for (const bloco in CONFIG.blocos) {
        const option = document.createElement("option");
        option.value = bloco;
        option.textContent = "Bloco " + bloco;
        seletor.appendChild(option);
    }

    seletor.value = blocoAtual;
    seletor.onchange = () => {
        blocoAtual = seletor.value;
        gerarMapa();
    };

    container.innerHTML = "";
    container.appendChild(seletor);

    // Criar área do mapa
    const areaMapa = document.createElement("div");
    areaMapa.id = "areaMapa";
    areaMapa.style.marginTop = "15px";
    container.appendChild(areaMapa);

    gerarMapa();
}

// ===== GERAR MAPA =====
function gerarMapa() {
    const areaMapa = document.getElementById("areaMapa");
    areaMapa.innerHTML = "";

    const config = CONFIG.blocos[blocoAtual];
    const [cInicio, cFim] = config.corredores;
    const [bInicio, bFim] = config.bins;

    const tabela = document.createElement("table");

    // Cabeçalho bins
    const header = document.createElement("tr");
    header.appendChild(document.createElement("td"));

    for (let b = bInicio; b <= bFim; b++) {
        const th = document.createElement("td");
        th.textContent = b;
        header.appendChild(th);
    }
    tabela.appendChild(header);

    // Linhas corredores
    for (let c = cInicio; c <= cFim; c++) {
        const tr = document.createElement("tr");

        const label = document.createElement("td");
        label.textContent = c;
        label.style.fontWeight = "bold";
        tr.appendChild(label);

        for (let b = bInicio; b <= bFim; b++) {
            const td = document.createElement("td");
            let status = "OK";

            if (dadosCSV[c] && dadosCSV[c][b]) {
                status = dadosCSV[c][b];
            }

            if (status === "ERRO") td.className = "erro";
            else if (status === "ALERTA") td.className = "alerta";
            else td.className = "ok";

            td.title = `Bloco ${blocoAtual} | Corredor ${c} | Bin ${b} | Status: ${status}`;

            tr.appendChild(td);
        }
        tabela.appendChild(tr);
    }

    areaMapa.appendChild(tabela);
}

// ===== INICIAR =====
document.addEventListener("DOMContentLoaded", carregarCSV);
