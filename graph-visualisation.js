const template = document.createElement('template');

template.innerHTML = `
  <style>    
    div.visualisation {
        padding: 0;
        margin: 0;
    	position: absolute;
    }
    form.toolbar {
    	position: absolute;
        font-family: sans-serif;
        box-sizing: border-box;
        font-size: small;
        display: flex;
        column-gap: 1rem;
        z-index: 1;
    }
    details.node-type-selector {
        position: relative;
    }
    details.node-type-selector summary {
        width: 15rem;
        background-color: #F0F0FF;
    }
    details.node-type-selector div.popup {
        position: absolute;
        width: 15rem;
        background-color: #F0F0FF;
    }
    details.node-type-selector div select {
        width: 15rem;
    }
    input#csvUpload {
        opacity: 0;
        width: 0;
    }
    label[for=csvUpload] {
        font-size: small;
        border-radius: 4px;
        border: solid 1px #20538D;
        text-shadow: 0 -1px 0 rgba(0, 0, 0, 0.4);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.4), 0 1px 1px rgba(0, 0, 0, 0.2);
        background: #4479BA;
        color: #FFF;
        padding: 2px 2px;
        text-decoration: none;
        cursor: default;
        display: block;
    }
    :host([data]) label[for=csvUpload] {
        display: none;
    }
    fieldset {
        flex-shrink: 0; 
        border-style: none;
        padding: 0;
        margin: 0;
    }
  </style>
  <form class="toolbar">
    <fieldset><label for="csvUpload">Open</label><input type="file" accept=".csv" id="csvUpload"></fieldset>
  </form>
  <div class="visualisation"></div>
`;

class GraphVisualisation extends HTMLElement {
    constructor() {
        super();
        let shadowRoot = this.attachShadow({mode: "open"});
        this.shadowRoot.appendChild(template.content.cloneNode(true));
        this.stylesheet = new CSSStyleSheet();
    }

    /*
        Utility method to write debugging data to the console's debug log, 
        if the Web Component's "log" attribute = "debug", or otherwise
        to do nothing.
    */
    debug(...data) {
        if (this.getAttribute("log") == "debug") {
            console.debug(...data);
        }
    }

    /*
        Callback invoked by the browser when an instance of this Web Component
        has been instantiated on a web page.

        Here we read the CSV file containing the graph data, parse it into the 
        appropriate data structures, and create the D3 visualisation of the graph..
    */
    async connectedCallback() {
        this.shadowRoot.adoptedStyleSheets = [this.stylesheet];
        this.adjacentLabelText = "Show connected";
        this.adjacentLabelTitle = "Show nodes of this type only if they're connected to another visible node"
        this.hideAllLabelText = "Hide all";
        this.hideAllLabelTitle = "Hide all nodes of this type";
        this.showAllLabelText = "Show all";
        this.showAllLabelTitle = "Show all nodes of this type";
        this.selectedLabelText = "Show only selected:";
        this.selectedLabelTitle = "Show nodes of this type only if they're selected in the list:";
        var data;
        var dataSourceUrl = this.getAttribute("data");
        if (dataSourceUrl) {
            try {
                this.debug("Reading data from " + dataSourceUrl);
                data = await d3.text(dataSourceUrl);
                this.debug("Successully read data from " + dataSourceUrl);
            } catch (error) {
                this.debug("Failed to read data from " + dataSourceUrl);
                alert("Failed to read data from " + dataSourceUrl);
            }
        } else {
            let data = localStorage.getItem('data');
        }
        if (data != null) {
        	this.parseData(data);
            this.updateToolbar();
            // Set up the simulation
            this.setupSimulation();
        // set the simulation's data
        this.updateSimulationData();

            // set the simulation's data
            this.toolbar.dispatchEvent(new Event("change"));
        }

        const fileInput = this.shadowRoot.getElementById('csvUpload');

        fileInput.addEventListener(
            'change', 
            this.HandleCSVUpload.bind(this)
        );
    }

    async HandleCSVUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        const data = await file.text();
            
        // Store CSV in localStorage
        localStorage.setItem('data', data);
        
        // parse the data into arrays of nodes and links
        this.parseData(data);

        // Update the set of popup menus in the toolbar
        this.updateToolbar();

        // Set up the simulation
        this.setupSimulation();

        // set the simulation's data
        this.updateSimulationData();
            this.toolbar.dispatchEvent(new Event("change"));
    }
    
    parseData(unnormalisedData) {
        let data = this.normaliseCSV(d3.csvParse(unnormalisedData));
        let primaryNodeColumnName = this.primaryNodeColumnName(data);
        this.linksData = this.links(data, primaryNodeColumnName);
        this.nodesData = this.nodes(data, primaryNodeColumnName);
    }

    updateToolbar() {
        // construct a colour palette to distinguish the different types of nodes
        let uniqueNodeTypes = this.nodesData
            .reduce(
                (nodeTypes, node) => nodeTypes.add(node.type),
                new Set()
            ); // deduplicate node types

        // Specify the color scale.
        const colour = d3.scaleSequential(d3.interpolateRainbow);
        this.nodeTypeColour = Array.from(uniqueNodeTypes)
            .sort()
            .reduce(
                (map, nodeType, ordinal, array) => map.set(nodeType, d3.color(colour(ordinal / array.length)).brighter().rgb()),
                new Map()
            );

        // copy the full linksData and nodesData arrays to create live versions 
        // of the arrays which we can filter, to underpin the simulation
        this.liveLinksData = this.linksData.map(row => row);
        this.liveNodesData = this.nodesData.map(row => row);
        let liveLinksData = this.liveLinksData;
        let liveNodesData = this.liveNodesData;

	// load previously-saved node-visibility settings from local storage
	let settings = this.loadSettings();
	
        // create selection UI
        let nodesByType = this.nodesByType(this.nodesData);

	let selectionUpdatedListener = this.nodeSelectionChanged.bind(this);
	
        this.toolbar = this.shadowRoot.querySelector('.toolbar');
        this.toolbar.removeEventListener(
            "change",
            selectionUpdatedListener
        );
        for (var item of this.toolbar.querySelectorAll('details')) {
            this.toolbar.removeChild(item);
        };
        for (const nodeType of nodesByType.keys()) {
            // create the UI for this type of node
            let details = document.createElement("details");
            details.setAttribute("class", "node-type-selector");
            let summary = document.createElement("summary");
            //  decorate node type widgets with their node's' colour
            let swatch = document.createElement("span");
            swatch.textContent = "● ";
            swatch.setAttribute("style", "color: " + this.nodeTypeColour.get(nodeType));
            let nodeTypeLabel = document.createElement("span");
            nodeTypeLabel.textContent = nodeType;
            summary.appendChild(swatch);
            summary.appendChild(nodeTypeLabel);
            
            // option to display or hide labels
            let divShowLabels = document.createElement("div");
            let id = encodeURIComponent(nodeType + " display labels");
            let labelShowLabels = document.createElement("label");
            labelShowLabels.setAttribute("for", id);
            labelShowLabels.textContent = "Display labels";
            let checkboxShowLabels = document.createElement("input");
            checkboxShowLabels.setAttribute("type", "checkbox");
            checkboxShowLabels.setAttribute("id", id);
            checkboxShowLabels.setAttribute("name", id);
            let showLabelsValue = this.getSettingValues(settings, id);
            if (showLabelsValue != 0) {
            	checkboxShowLabels.checked = true;
            }
            divShowLabels.appendChild(checkboxShowLabels);
            divShowLabels.appendChild(labelShowLabels);
            
            let divSelectionMode = document.createElement("div");
            // option to show nodes of this type only when adjacent to selected nodes
            // (This is the default for secondary node types)
            let divAdjacent = this.createRadioButtonDiv(
                nodeType, 
                this.adjacentLabelText,
                this.adjacentLabelTitle,
                "adjacent"
            );

            let divAll = this.createRadioButtonDiv(
                nodeType, 
                this.showAllLabelText,
                this.showAllLabelTitle,
                "all"
            );

            let divNone = this.createRadioButtonDiv(
                nodeType, 
                this.hideAllLabelText,
                this.hideAllLabelTitle,
                "none"
            );

            // option to explicitly select nodes to show
            let divSelected = this.createRadioButtonDiv(
                nodeType, 
                this.selectedLabelText,
                this.selectedLabelTitle,
                "selected"
            );

            // list of nodes for making explicit selections
            let selectNodes = document.createElement("select");
            selectNodes.setAttribute("name", nodeType);
            selectNodes.disabled = true;
            selectNodes.setAttribute("class", "node-list");
            selectNodes.multiple = true;
            let nodeNames = nodesByType.get(nodeType)
                .sort((a, b) => a.localeCompare(b, undefined, {sensitivity: 'base'}))
            selectNodes.setAttribute("size", Math.min(nodeNames.length, 10));
            nodeNames
                .forEach(
                    function(nodeName) {
                        let option = document.createElement("option");
                        option.textContent = nodeName;
                        option.setAttribute("value", nodeName);
                        // by default, select the names of all primary nodes and
                        // leave the names of secondary nodes unselected
                        //option.selected = primaryNodeColumnName == nodeType;
                        selectNodes.appendChild(option);
                    }
                );

            // wrap the contents of the details element in a div for positioning
            let div = document.createElement("div");
            div.setAttribute("class", "popup");
            this.toolbar.appendChild(details);
            details.appendChild(summary);
            details.appendChild(div);
            div.appendChild(divShowLabels)
            div.appendChild(divSelectionMode);
            divSelectionMode.appendChild(divAdjacent);
            divSelectionMode.appendChild(divAll);
            divSelectionMode.appendChild(divNone);
            divSelectionMode.appendChild(divSelected);
            div.appendChild(selectNodes);

            let buttons = div.querySelectorAll("input[type=radio]");
            let buttonName = buttons[0].name;
            let buttonSavedValues = this.getSettingValues(settings, buttonName);
            let buttonSavedValue = (buttonSavedValues.length == 0) ? 'adjacent' : buttonSavedValues[0];
            for (const button of buttons) {
            	if (button.value == buttonSavedValue) { 
            		button.setAttribute("checked", "checked") 
            	}
	}
	selectNodes.disabled = buttonSavedValue != "selected"; 
	let savedSelectedNodes = this.getSettingValues(settings, selectNodes.name);
	for (const option of selectNodes.options) {
		// run through the options in the selection list and select any which had been saved
		option.selected = savedSelectedNodes.includes(option.value);
	}
		
            

            // automate the enablement of the select list
            // Install event listener to listen to the radio buttons and
            // enable or disable the select list. NB the "change" event
            // is fired when a radio button is checked but NOT when 
            // it's unchecked. So the select widget is enabled and 
            // disabled by "change" events from the "selected" button
            // and any of the other button elements, respectively.
            divSelectionMode.addEventListener(
                "change",
                function(event) {
                    // disable the node-selection list if the new node selection 
                    // option has been set to something other than "selected"'
                    switch (event.target.value) {
                    case "adjacent":
                    	selectNodes.disabled = true;
                    	break;
                    case "none": 
                        selectNodes.selectedIndex = -1;
                        selectNodes.disabled = true;
                        break;
                    case "all":
                        for (const option of selectNodes.getElementsByTagName("option")) {
                            option.selected = true;
                        }
                        selectNodes.disabled = true;
                        break;
                    case "selected":
                    	selectNodes.disabled = false;
                    	selectNodes.focus();
                    	break;
                    }
                }
            );
        }
        // respond to the user's selection of nodes
        this.toolbar.addEventListener(
            "change",
            selectionUpdatedListener
        );
        // dispatch a change event to trigger the graph selection to change
        //this.toolbar.dispatchEvent(new Event("change"));
    }

    /*
        Create a div with a radio button to define which nodes of a particular type will be selected.
    */
    createRadioButtonDiv(nodeType, labelText, titleText, value) {
        let div = document.createElement("div");
        let id = encodeURIComponent(nodeType + labelText);
        let label = document.createElement("label");
        label.setAttribute("for", id);
        label.textContent = labelText;
        label.setAttribute("title", titleText);
        let button = document.createElement("input");
        button.setAttribute("type", "radio");
        button.setAttribute("id", id);
        button.setAttribute("name", nodeType + "-mode");
        button.setAttribute("value", value);
        button.setAttribute("title", titleText);
        div.appendChild(button);
        div.appendChild(label);
        return div;
    }

    /*
        Determine the column name of "primary" nodes in the graph. This is the value
        of the first cell in the heading row of the CSV, and it provides the label for
        the primary nodes' type. By contrast, the secondary (or "other") nodes have a 
        type which is explicitly given for each node, the "other_node_type" column.

        NB the order of keys in a JavaScript object is variable and not signficant, so
        the primaryNodeColumnName is determined by taking the first data row from array
        of objects produced by parsing the CSV, looking through the property names in
        that object, filtering out the names "other_node" and "other_node_type", and returning
        the remaining column name.
    */
    primaryNodeColumnName(csv) {
        return Array.from(
            Object.getOwnPropertyNames(
                csv.at(0) // an object representing the first data row from the CSV
            ) 
        ) // array of the three column names
            .filter(
                (columnName) => !['other_node', 'other_node_type'].includes(columnName)
            ) // filter out the column names "other_node" and "other_node_type"
            [0]; // return the first (and only!) remaining column-name
    }

    /*
        Transform the array containing the raw CSV data into an array of edge objects,
        each with a "source" and a "target" property
    */
    links(csv, primaryColumnName) {
        return csv.map(
            function(row) {
                return {
                    "source": primaryColumnName + ": " + row[primaryColumnName], 
                    "target": row["other_node_type"] + ": " + row["other_node"]
                }
            }
        )
    }

    /*
        Normalise the CSV; the CSV array uses a sparse encoding in which a
        blank cell means "same as the last non-empty value in this column"
    */
    normaliseCSV(csv) {
        let normalisedCSV = csv.reduce(
            function(csvSoFar, row) {
                let previousRow = csvSoFar.at(-1);
                let newRow = new Object();
                for (const [key, value] of Object.entries(row)) {
                    if (value == "") {
                        newRow[key] = previousRow[key];
                    } else {
                        newRow[key] = value.trim().replace(/\s+/g, ' ');
                    }
                }
                csvSoFar.push(newRow);
                return csvSoFar;
            },
            []
        );
//        this.debug("Normalised CSV", this.stringify(Object.fromEntries(normalisedCSV.entries())));
        return normalisedCSV;
    }

    /*
        Transform the array containing the raw CSV data into an array of node objects,
        each with an "name" and a "type" property
    */
    nodes(csv, primaryNodeColumnName) {
        let uniquePrimaryNodes = csv
            .reduce(
                function(map, row) {
                    let primaryNodeName = row[primaryNodeColumnName];
                    if (map.has(primaryNodeName))
                        row.degree = 1 + map.get(primaryNodeName).degree;
                    else
                        row.degree = 1;
                    return map.set(primaryNodeName, row);
                },
                new Map()
            ).values().toArray() // array of rows with duplicate primary nodes removed
            .map(
                function(row) {
                    return {
                        id: primaryNodeColumnName + ": " + row[primaryNodeColumnName],
                        name: row[primaryNodeColumnName],
                        type: primaryNodeColumnName,
                        primary: true,
                        degree: row.degree
                    }
                }
            ); // array of unique "primary" node objects from CSV
        let uniqueOtherNodes = csv
            .reduce(
                function(map, row) {
                    let key = row.other_node_type + ": " + row.other_node;
                    if (map.has(key))
                        row.degree = 1 + map.get(key).degree;
                    else
                        row.degree = 1;
                    return map.set(key, row);
                },
                new Map()
            ).values().toArray() // array of rows with duplicate other_node values removed
            .map(
                function(row) {
                    return {
                        id: row["other_node_type"] + ": " + row["other_node"],
                        name: row["other_node"], 
                        type: row["other_node_type"],
                        primary: false,
                        degree: row.degree
                    }  
                }
            ); // array of unique "other_node" node objects from CSV

        // return an array of node objects from both the "primary" and "other_node" CSV columns
        return uniquePrimaryNodes.concat(uniqueOtherNodes);
    }

    /*
        Transform the array of node objects (with 'name' and 'type' properties) into a map 
        whose keys are the 'type' values, and whose values are an array of the 'name' properties
        of nodes with that type
    */
    nodesByType(nodesData) {
        return nodesData
            .reduce(
                function(map, node) {
                    var nodesOfType;
                    if (map.has(node.type)) {
                        // the map already contains a list of nodes of this type
                        nodesOfType = map.get(node.type);
                    } else {
                        // this is the first node of its type
                        nodesOfType = new Array();
                    }
                    nodesOfType.push(node.name);
                    return map.set(node.type, nodesOfType);
                },
                new Map()
            )
    }

    // debugging, logging, etc.
    stringify(data) {
        return JSON.stringify(data, null, 3);
    }
    
    // settings
    saveSettings(formData) {
        var jsonBuilder = new Object();
        for (const key of formData.keys()) {
	    jsonBuilder[key] = formData.getAll(key);
        }
        localStorage.setItem("settings", JSON.stringify(jsonBuilder));
    }
    loadSettings() {
    	let settings = localStorage.getItem("settings");
    	if (settings) {
    		return JSON.parse(settings);
    	} else {
    		return new Object();
    	}
    }
    getSettingValues(settings, name) {// settings are always an array
    	let value = settings[name];
    	if (value) { 
    		return value;
    	}
    	return new Array();
    }

    /*
        Handle the event produced by the user changing the selection
        criteria for nodes. 
    */
    nodeSelectionChanged(event) {
        let formData = new FormData(event.currentTarget);
        // save the current state of the configuration UI
        this.saveSettings(formData);

	// show or hide labels 
        let nodesByType = this.nodesByType(this.nodesData);
        let styles = nodesByType.keys().reduce(
        	function(styles, nodeType) {
        		let settingName = encodeURIComponent(nodeType + " display labels"); 
        		if (formData.get(settingName) != "on") {
				return styles + "text." + nodeType.replace(/\W/g, '') + " {\n   display: none;\n}\n";
			}
			return styles;
        	},
        	""
	);
	this.stylesheet.replaceSync(styles);
        
        // show and hide nodes and links
        let selectedNodesData = this.nodesData.filter(
            function(node) {
                // whether a node should be shown depends on the "selection mode"
                // the user specified for nodes of that type
                switch (formData.get(node.type + "-mode")) {
                    case "selected": // nodes of this type are to be shown only if explicitly selected
                        return formData.getAll(node.type).includes(node.name);
                    case "all": // all nodes of this type should be shown
                        return true;
                    default: // nodes of this type should be hidden, 
                        // OR shown where adjacent to visible nodes (handled below)
                        return false;
                }
            }
        );
        
        // find the nodes which should be added to the selection by virtue of being connected
        // to nodes which were shown by "show all" or "show selected"
        let adjacentNodesData = this.getAdjacentNodes(selectedNodesData, formData);
        // find the nodes which should be added to the selection by virtue of being connected
        // to nodes which were themselves connected to nodes which were shown by "show all" 
        // or "show selected"
        let secondaryAdjacentNodesData = this.getAdjacentNodes(adjacentNodesData, formData);

//        this.debug(this.stringify(this.nodesData));
        let newNodesData = selectedNodesData.concat(adjacentNodesData).concat(secondaryAdjacentNodesData);

        this.liveNodesData = newNodesData;
        this.liveLinksData = this.linksData.filter(
            function (link) {
                let linkSourceIsSelected = newNodesData.some(node => node.id === link.source.id);
                let linkTargetIsSelected = newNodesData.some(node => node.id === link.target.id) ;
                return linkSourceIsSelected && linkTargetIsSelected;
            }
        )
        
        this.updateSimulationData();
    }
    
    /*
    	Takes a list of selected nodes, and returns a list of additional nodes
    	which should be added by virtue of being adjacent to one or more of those nodes.
    	The formData object describes the current setting of the UI, showing which
    	types of node are set to "show connected".
    */
    getAdjacentNodes(selectedNodes, formData) {
        // construct an array of the node identifiers of neighbours of selected nodes
        let neighbourNodeIdentifiers = new Array();
        for (const link of this.linksData) {
            if (selectedNodes.some(
                function(selectedNode) {
                    let match = (selectedNode.id === link.source.id);
                    return match;
                }
            )) neighbourNodeIdentifiers.push(link.target.id);
            if (selectedNodes.some(
                selectedNode => (selectedNode.id === link.target.id)
            )) neighbourNodeIdentifiers.push(link.source.id);
        }

        // find the nodes which are not directly selected but which
        // should be included because they have links to selected nodes
        let adjacentNodes = this.nodesData.filter(
            function(node) {
                if (formData.get(node.type + "-mode") === "adjacent")
                    return neighbourNodeIdentifiers.includes(node.id);
                else
                    return false;
            }
        );
        
        return adjacentNodes;
    }

    /*
        Update the simulation with a new set of nodes and links
    */
    updateSimulationData() {
        this.simulation.nodes(this.liveNodesData);
        this.simulation.force("link").links(this.liveLinksData);
        // Add a line for each link, and a circle for each node.
        const linkSelection = this.svgLinksLayer
            .selectAll("line")
            .data(this.liveLinksData, d => d.id)
            .join("line")
            .attr("stroke", "#999")
            .attr("stroke-opacity", 0.6)
            .attr("stroke-width", 2);
      
        const nodeSelection = this.svgNodesLayer
            .selectAll("svg.node")
            .data(this.liveNodesData, d => d.id)
            .join("svg")
            .attr("overflow", "visible")
            .attr("class", "node");
            
	nodeSelection
	.append("circle")
		.attr("stroke", "#fff")
		.attr("stroke-width", 1.5)
		.attr("r", d => 5 * Math.cbrt(d.degree))
		.attr("fill", d => this.nodeTypeColour.get(d.type))
		.attr('class', d => encodeURIComponent(d.type))
		.append("title").text(d => d.id);
        nodeSelection
	.select(function(d) {
		let text =	document.createElementNS("http://www.w3.org/2000/svg", "text");
		let title = document.createElementNS("http://www.w3.org/2000/svg", "title");
		title.textContent = d.id;
		text.appendChild(title);
		let fontSize = 12;
		text.setAttribute("class", d.type.replace(/\W/g, ''));
		text.setAttribute("x", "0");
		text.setAttribute("text-anchor", "middle")
		text.setAttribute("dominant-baseline", "middle")
		// define a smi-transparent white keyline
		text.setAttribute("stroke-width", "4px")
		text.setAttribute("stroke-color", "white")
		text.setAttribute("stroke-opacity", "0.5")
		text.setAttribute("paint-order", "stroke")
		text.setAttribute("font-family", "sans-serif")
		text.setAttribute("font-size", fontSize.toString() + "px")
		//text.setAttribute("font-weight", "bold")
		text.setAttribute("fill", "black");
		
		let lineHeight = 1.2 * fontSize;
		// calculate an appropriate line length: narrow enough to break the label into three lines, 
		// except with a minimum width of 15 characters, and a maximum of 30 characters.
		let maxLineLength = Math.min(30, Math.max(d.name.length / 3, 15));
		let words = d.name.replaceAll('-', '- ').split(" "); // tokenize the description
		let lines = words.reduce(
			function(lines, word) {
				let currentLine = lines.at(-1);
				if (currentLine == undefined) {
					// there are zero lines (this must be the first word)
					lines.push(word);
					return lines;
				}
				if (currentLine.length + 1 + word.length <= maxLineLength) {
					// the new word will fit on the current line
					lines.pop();
					lines.push(currentLine + " " + word);
					return lines;
				}
				// otherwise the word does not fit so we start a new line
				lines.pop();
				lines.push(currentLine + " ");
				lines.push(word);
				return lines;
			},
			new Array()
		);
		lines.forEach(
			function(line, lineNumber) {
				let tspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
				if (lineNumber == 0) {
					tspan.setAttribute("y", (lines.length - 1) * -0.5 * lineHeight);
				} else {
					tspan.setAttribute("dy", lineHeight);
				}
				tspan.setAttribute("x", "0");
				tspan.textContent = line;
				text.appendChild(tspan);
			}
		);
		this.appendChild(text);
		return text;
	});

        // Set the position attributes of links and nodes each time the simulation ticks.
        this.simulation.on("tick", 
            function() {
                linkSelection
                    .attr("x1", d => d.source.x)
                    .attr("y1", d => d.source.y)
                    .attr("x2", d => d.target.x)
                    .attr("y2", d => d.target.y);

                nodeSelection
                    .attr("x", d => d.x)
                    .attr("y", d => d.y);
            }
        );

        // Add a drag behavior.
        nodeSelection.call(
            d3.drag()
                .on("start", this.dragstarted.bind(this))
                .on("drag", this.dragged.bind(this))
                .on("end", this.dragended.bind(this))
        );

        // restart the simulation which may have stopped
        this.simulation.alphaTarget(0.3).restart();
    }

    /*
        Set up the physics of the simulation and SVG containers for the nodes and edges
    */
    setupSimulation() {
        if (this.svg != undefined) return;

        // TODO read width and height from container
        let width = this.clientWidth;//1600;
        let height = this.clientHeight;//780;

        // Create the SVG container.
        this.svg = d3.create("svg")
            .attr("width", width)
            .attr("height", height)
            .attr("viewBox", [-width / 2, -height / 2, width, height])
            .attr("style", "max-width: 100%; height: auto;");
            
        this.svgLinksLayer = this.svg.append("g")
            .attr("class", "links")
            .attr("stroke", "#999")
            .attr("stroke-opacity", 0.6);

        this.svgNodesLayer = this.svg.append("g")
            .attr("class", "nodes")
            .attr("stroke", "#fff")
            .attr("stroke-width", 1.5);

        this.shadowRoot.querySelector("div.visualisation").appendChild(this.svg.node());


        // Create a simulation with several forces.
        this.simulation = d3.forceSimulation()
            .velocityDecay(0.7)
            .alphaDecay(0.02)
            .force("link", d3.forceLink().distance(50).id((d) => d.id))
            .force(
                "charge", 
                d3.forceManyBody()
                    .strength(
                        function (node) {
                            // scale the repelling force by node degree
                            return - 30 * node.degree
                        }
                    )
            )
            .force(
            	"center",
            	d3.forceCenter()
            )
            .force("x", d3.forceX())
            .force("y", d3.forceY())
            .force("collide", d3.forceCollide(25));

        this.svg.call(d3.zoom().on("zoom", zoomed));

        var svg = this.svg;
        function zoomed(event) {
            svg.attr("transform", event.transform);
        }
}

        // Reheat the simulation when drag starts, and fix the subject position.
        dragstarted(event) {
            if (!event.active) this.simulation.alphaTarget(0.3).restart();
            event.subject.fx = event.subject.x;
            event.subject.fy = event.subject.y;
        }

        // Update the subject (dragged node) position during drag.
        dragged(event) {
            event.subject.fx = event.x;
            event.subject.fy = event.y;
        }

        // Restore the target alpha so the simulation cools after dragging ends.
        // Unfix the subject position now that it’s no longer being dragged.
        dragended(event) {
            if (!event.active) this.simulation.alphaTarget(0);
                event.subject.fx = null;
                event.subject.fy = null;
            }
        }

/*
    Register the Web Component
*/
customElements.define('graph-visualisation', GraphVisualisation);
