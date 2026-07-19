// Grab the README so people have some info on the site without having to go to the repository
fetch('README.md')
    .then(function (response) { return response.text(); })
    .then(function (text) {
        document.getElementById('readme-content').innerHTML = marked.parse(text);
    })
    .catch(function (error) {
        console.log(error);
        document.getElementById('readme-content').textContent = 'Could not load README.'
    })