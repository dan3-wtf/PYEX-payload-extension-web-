// TECHNOLOGY DETECTOR CONTENT SCRIPT
(function () {
    const detectTech = () => {
        const results = {
            html: document.documentElement.innerHTML,
            meta: {},
            scripts: [],
            url: window.location.href
        };

        // Get Meta Tags
        document.querySelectorAll('meta').forEach(meta => {
            const name = meta.getAttribute('name') || meta.getAttribute('property');
            const content = meta.getAttribute('content');
            if (name && content) {
                results.meta[name.toLowerCase()] = content;
            }
        });

        // Get Script Sources
        document.querySelectorAll('script').forEach(script => {
            const src = script.getAttribute('src');
            if (src) {
                results.scripts.push(src);
            }
        });

        return results;
    };

    // Return results to the script executing this
    return detectTech();
})();
