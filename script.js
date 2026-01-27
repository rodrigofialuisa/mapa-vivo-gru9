document.addEventListener("DOMContentLoaded", () => {
    console.log("✅ Script.js carregado");

    const mapaDiv = document.getElementById("mapa");
    mapaDiv.innerHTML = "<p>🔄 Carregando mapa...</p>";

    carregarCSV();
});

async function carregarCSV() {
    try {
        console.log("🔎 Tentando carregar dados.csv...");

        const response = await fetch("./dados.csv");

        console.log("📡 Status HTTP:", response.status);

        if (!response.ok) {
            throw new Error("dados.csv não encontrado");
        }

        const texto = await response.text();
        console.log("✅ CSV carregado com sucesso!");
        console.log(texto.substring(0,200)); // mostra começo do CSV

        const dados = processarCSV(texto);
        gerarMapaSimples(dados);

    } catch (erro) {
        console.error("❌ Erro:", erro);
        document.getElementById("mapa").innerHTML =
            "<p style='color:red'>❌ Não foi possível carregar dados.csv</p>";
    }
}

function processarCSV(texto) {
    const linhas = texto.trim().split("\n");
    const dados = {};

    for (let i = 1; i < linhas.length; i++) {
        const [corredor, bin, status] = linhas[i].split(",");
        if (!dados[corredor]) dados[corredor] = {};
        dados[corredor][bin] = status.trim();
    }
    return dados;
}

// mapa mínimo só para confirmar funcionamento
function gerarMapaSimples(dados) {
    const mapaDiv = document.getElementById("mapa");
    mapaDiv.innerHTML = "<h3>✅ Mapa carregado com sucesso!</h3>";

    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(dados, null, 2);
    mapaDiv.appendChild(pre);
}
