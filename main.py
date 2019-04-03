import os
import json
import sqlite3
from pathlib import Path

import unicodedata2 as unicodedata
# import redis
from jinja2 import Template
from sanic import Sanic, response
import ideograph

app = Sanic()

app.static("/static", "./static")

conn = sqlite3.connect("cmp-log.db")
cursor = conn.cursor()
# r = redis.Redis()
# component_counter = Counter(json.load(open("component_counter.json")))

def create_cmp_log():
    cursor.execute("CREATE TABLE cmp_log (cmp text PRIMARY KEY, num int)")

def stroke_sort(c):
    s = unicodedata.total_strokes(c)
    if s == 0:
        return 255
    else:
        return s

@app.get("/")
async def main(request):
    try:
        components = request.args['components'][0]
    except KeyError:
        components = ""
    for comp in components:
        # r.zincrby("cmps", 1, comp)
        cursor.execute("INSERT OR IGNORE INTO cmp_log VALUES (?, 0)", comp)
        cursor.execute("UPDATE cmp_log SET num = (num + 1) WHERE cmp = ?", comp)
    conn.commit()
    template = Template(open("form.jinja2").read())
    ideos = sorted(ideograph.find(components), key=stroke_sort)
    ideographs = [(i, "".join(sorted(ideograph.components(i), key=stroke_sort))) for i in ideos]
    # try:
    #     common_components = [c.decode("utf-8") for c in r.zrevrange("cmps", 0, -1)]
    # except ConnectionError:
    cursor.execute("SELECT cmp FROM cmp_log ORDER BY num DESC")
    common_components = [c[0] for c in cursor.fetchall()]
    return response.html(template.render(
        components=components,
        ideographs=ideographs,
        common_components=common_components,
        ))

if __name__ == "__main__":
    try:
        app.run(host="0.0.0.0", port=int(os.environ.get("PORT")))
    except TypeError:
        app.run()