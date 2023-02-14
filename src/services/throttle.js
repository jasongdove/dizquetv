// Adds a slight pause so that long operations
export default function () {
    return new Promise((resolve) => {
        setImmediate(() => resolve());
    });
}
