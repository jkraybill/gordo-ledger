const { parseGenericFiles } = require('./dist/parser/generic-file-parser.js');

const config = {
  indexDocs: true,
  indexCode: true
};

parseGenericFiles('/home/jkraybill/home-server', config).then(files => {
  console.log(`Found ${files.length} files`);
  console.log('First 5 files:');
  files.slice(0, 5).forEach(f => {
    console.log(`  - ${f.id} (${f.contentType})`);
  });
}).catch(err => {
  console.error('Error:', err);
});
