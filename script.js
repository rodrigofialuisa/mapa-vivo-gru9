// === CONFIGURAÇÕES DO MAPA ===
const totalCorredores = 300;   // 100 → 399 (exemplo)
const totalBins = 100;          // 100 → 199 (exemplo)

// Status possíveis
// OK = verde
// ALERTA = amarelo
// ERRO = vermelho

async function carregarCSV() {
    const response = await fetch("dados.csv");
    const data = await response.text();
    return processarCSV(data);
}

function processarCSV(texto) {
    const linhas = texto.trim().split("\n");
    const resultado = {};

    // Ignora cabeçalho
    for (let i = 1; i < linhas.length; i++) {
        const [corredor, bin, status] = linhas[i].split(",");

        if (!resultado[corredor]) {
            resultado[corredor] = {};
        }
        resultado[corredor][bin] = status.trim();
    }
    return resultado;
}

function gerarMapa(dados) {
    const container = document.getElementById("mapa");
    const tabela = document.createElement("table");

    // Cabeçalho dos bins
    const header = document.createElement("tr");
    header.appendChild(document.createElement("td")); // canto vazio

    for (let b = 100; b < 100 + totalBins; b++) {
        const th = document.createElement("td");
        th.textContent = b;
        header.appendChild(th);
    }
    tabela.appendChild(header);

    // Linhas dos corredores
    for (let c = 100; c < 100 + totalCorredores; c++) {
        const tr = document.createElement("tr");

        // Número do corredor
        const label = document.createElement("td");
        label.textContent = c;
        label.style.fontWeight = "bold";
        tr.appendChild(label);

        // Bins
        for (let b = 100; b < 100 + totalBins; b++) {
            const td = document.createElement("td");

            let status = "OK"; // padrão

            if (dados[c] && dados[c][b]) {
                status = dados[c][b];
            }

            if (status === "ERRO") td.className = "erro";
            else if (status === "ALERTA") td.className = "alerta";
            else td.className = "ok";

            td.title = `Corredor ${c} - Bin ${b} : ${status}`;

            tr.appendChild(td);
        }

        tabela.appendChild(tr);
    }

    container.innerHTML = "";
    container.appendChild(tabela);
}

// Inicialização
carregarCSV().then(dados => gerarMapa(dados));
