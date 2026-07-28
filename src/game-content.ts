export interface WordEntry {
  answer: string;
  category: string;
}

export const WORDS: readonly WordEntry[] = [
  { answer: "komodo", category: "hewan Indonesia" },
  { answer: "borobudur", category: "tempat Indonesia" },
  { answer: "angkot", category: "transportasi" },
  { answer: "sate", category: "makanan" },
  { answer: "pelangi", category: "alam" },
  { answer: "astronomi", category: "sains" },
  { answer: "keyboard", category: "teknologi" },
  { answer: "perpustakaan", category: "tempat" },
  { answer: "rendang", category: "makanan" },
  { answer: "gamelan", category: "budaya" },
  { answer: "raflesia", category: "tumbuhan" },
  { answer: "gerhana", category: "alam" },
  { answer: "batik", category: "budaya" },
  { answer: "orangutan", category: "hewan Indonesia" },
  { answer: "kalkulator", category: "teknologi" },
  { answer: "wayang", category: "budaya" },
  { answer: "vulkanologi", category: "sains" },
  { answer: "kelelawar", category: "hewan" },
  { answer: "kemerdekaan", category: "sejarah" },
  { answer: "monas", category: "tempat Indonesia" },
  { answer: "kompas", category: "alat" },
  { answer: "harimau", category: "hewan" },
  { answer: "smartphone", category: "teknologi" },
  { answer: "bioskop", category: "tempat" },
  { answer: "nusantara", category: "sejarah" },
  { answer: "teleskop", category: "sains" },
  { answer: "gunungapi", category: "alam" },
  { answer: "kupukupu", category: "hewan" },
  { answer: "pramuka", category: "organisasi" },
  { answer: "eskrim", category: "makanan" },
  { answer: "layangan", category: "permainan" },
  { answer: "perahu", category: "transportasi" },
];

export interface TriviaQuestion {
  prompt: string;
  category: string;
  choices: readonly [string, string, string, string];
  correctIndex: number;
}

export const TRIVIA_QUESTIONS: readonly TriviaQuestion[] = [
  { prompt: "Planet terdekat dari Matahari adalah…", category: "Sains", choices: ["Merkurius", "Venus", "Bumi", "Mars"], correctIndex: 0 },
  { prompt: "Semboyan nasional Indonesia adalah…", category: "Sejarah", choices: ["Tut Wuri Handayani", "Bhinneka Tunggal Ika", "Pancasila", "Merdeka Belajar"], correctIndex: 1 },
  { prompt: "Berapa jumlah sisi pada sebuah heksagon?", category: "Matematika", choices: ["5", "6", "7", "8"], correctIndex: 1 },
  { prompt: "Bahasa pemrograman yang berjalan di browser adalah…", category: "Teknologi", choices: ["Java", "Python", "JavaScript", "C#"], correctIndex: 2 },
  { prompt: "Ibu kota negara Jepang adalah…", category: "Geografi", choices: ["Seoul", "Beijing", "Tokyo", "Bangkok"], correctIndex: 2 },
  { prompt: "Hewan apa yang dijuluki 'raja hutan'?", category: "Sains", choices: ["Harimau", "Singa", "Gajah", "Beruang"], correctIndex: 1 },
  { prompt: "Candi Borobudur terletak di provinsi…", category: "Geografi Indonesia", choices: ["Jawa Barat", "Jawa Tengah", "Jawa Timur", "DI Yogyakarta"], correctIndex: 1 },
  { prompt: "Berapa jumlah pemain inti dalam satu tim sepak bola di lapangan?", category: "Olahraga", choices: ["9", "10", "11", "12"], correctIndex: 2 },
  { prompt: "Proklamasi kemerdekaan Indonesia dibacakan pada tanggal…", category: "Sejarah", choices: ["17 Agustus 1945", "20 Mei 1945", "28 Oktober 1945", "1 Juni 1945"], correctIndex: 0 },
  { prompt: "Organ tubuh yang memompa darah ke seluruh tubuh adalah…", category: "Sains", choices: ["Paru-paru", "Jantung", "Hati", "Ginjal"], correctIndex: 1 },
  { prompt: "Mata uang resmi negara Jepang adalah…", category: "Umum", choices: ["Won", "Yuan", "Yen", "Ringgit"], correctIndex: 2 },
  { prompt: "Gunung tertinggi di dunia adalah…", category: "Geografi", choices: ["K2", "Everest", "Kilimanjaro", "Elbrus"], correctIndex: 1 },
  { prompt: "Berapa jumlah provinsi di Indonesia saat ini (perkiraan resmi terbaru)?", category: "Geografi Indonesia", choices: ["34", "36", "38", "40"], correctIndex: 2 },
  { prompt: "Penemu bola lampu pijar yang terkenal adalah…", category: "Sejarah", choices: ["Nikola Tesla", "Thomas Edison", "Alexander Graham Bell", "James Watt"], correctIndex: 1 },
  { prompt: "Satuan dasar untuk mengukur arus listrik adalah…", category: "Sains", choices: ["Volt", "Watt", "Ampere", "Ohm"], correctIndex: 2 },
  { prompt: "Danau terbesar di Indonesia adalah…", category: "Geografi Indonesia", choices: ["Danau Toba", "Danau Sentani", "Danau Maninjau", "Danau Poso"], correctIndex: 0 },
  { prompt: "Hasil dari 12 x 8 adalah…", category: "Matematika", choices: ["86", "94", "96", "104"], correctIndex: 2 },
  { prompt: "Benua terluas di dunia adalah…", category: "Geografi", choices: ["Afrika", "Asia", "Eropa", "Amerika Utara"], correctIndex: 1 },
  { prompt: "Alat musik tradisional dari Jawa berupa seperangkat gong dan kendang disebut…", category: "Budaya", choices: ["Angklung", "Gamelan", "Sasando", "Kolintang"], correctIndex: 1 },
  { prompt: "Planet yang dikenal sebagai 'planet merah' adalah…", category: "Sains", choices: ["Jupiter", "Saturnus", "Mars", "Merkurius"], correctIndex: 2 },
  { prompt: "Bahasa resmi yang digunakan di Brasil adalah…", category: "Umum", choices: ["Spanyol", "Portugis", "Inggris", "Prancis"], correctIndex: 1 },
  { prompt: "Lambang negara Indonesia adalah…", category: "Sejarah", choices: ["Garuda Pancasila", "Elang Jawa", "Rajawali", "Merpati"], correctIndex: 0 },
  { prompt: "Angka Romawi 'L' bernilai…", category: "Matematika", choices: ["500", "5", "50", "100"], correctIndex: 2 },
  { prompt: "Samudra terluas di dunia adalah…", category: "Geografi", choices: ["Atlantik", "Hindia", "Pasifik", "Arktik"], correctIndex: 2 },
  { prompt: "Proses tumbuhan mengubah cahaya matahari menjadi energi disebut…", category: "Sains", choices: ["Respirasi", "Fotosintesis", "Transpirasi", "Fermentasi"], correctIndex: 1 },
  { prompt: "Julukan 'Kota Kembang' merujuk pada kota…", category: "Geografi Indonesia", choices: ["Bandung", "Malang", "Surabaya", "Semarang"], correctIndex: 0 },
  { prompt: "Cabang olahraga bulu tangkis dimainkan menggunakan…", category: "Olahraga", choices: ["Bola dan raket", "Kok dan raket", "Stik dan bola", "Tongkat dan bola"], correctIndex: 1 },
  { prompt: "Berapa jumlah tulang pada tubuh manusia dewasa (perkiraan umum)?", category: "Sains", choices: ["186", "206", "226", "246"], correctIndex: 1 },
  { prompt: "Sungai terpanjang di dunia adalah…", category: "Geografi", choices: ["Amazon", "Nil", "Yangtze", "Mississippi"], correctIndex: 1 },
  { prompt: "Presiden pertama Republik Indonesia adalah…", category: "Sejarah", choices: ["Soeharto", "Soekarno", "B.J. Habibie", "Mohammad Hatta"], correctIndex: 1 },
  { prompt: "Jenis awan yang berbentuk seperti kapas dan menandakan cuaca cerah adalah…", category: "Sains", choices: ["Kumulus", "Stratus", "Sirus", "Nimbus"], correctIndex: 0 },
  { prompt: "Kata 'byte' terdiri dari berapa bit?", category: "Teknologi", choices: ["4", "8", "16", "32"], correctIndex: 1 },
  { prompt: "Alat pernapasan utama pada ikan adalah…", category: "Sains", choices: ["Paru-paru", "Insang", "Kulit", "Trakea"], correctIndex: 1 },
  { prompt: "Perang Diponegoro dikenal juga dengan sebutan…", category: "Sejarah", choices: ["Perang Padri", "Perang Jawa", "Perang Aceh", "Perang Puputan"], correctIndex: 1 },
  { prompt: "Jumlah hari pada tahun kabisat adalah…", category: "Matematika", choices: ["364", "365", "366", "367"], correctIndex: 2 },
  { prompt: "Kota yang dijuluki 'The Big Apple' adalah…", category: "Umum", choices: ["Los Angeles", "New York", "Chicago", "Boston"], correctIndex: 1 },
  { prompt: "Bagian bunga yang berfungsi sebagai alat kelamin jantan adalah…", category: "Sains", choices: ["Putik", "Benang sari", "Mahkota", "Kelopak"], correctIndex: 1 },
  { prompt: "Suku bangsa asli Papua yang terkenal dengan tarian perang adalah…", category: "Budaya", choices: ["Suku Dani", "Suku Asmat", "Suku Baliem", "Suku Sentani"], correctIndex: 0 },
  { prompt: "Hasil dari akar kuadrat 144 adalah…", category: "Matematika", choices: ["10", "11", "12", "14"], correctIndex: 2 },
  { prompt: "Julukan negeri 'Matahari Terbit' merujuk pada negara…", category: "Umum", choices: ["Korea Selatan", "Tiongkok", "Jepang", "Thailand"], correctIndex: 2 },
];
